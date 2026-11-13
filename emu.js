/*
 * emu.js — 筐体UIと入力レイヤー
 *
 *   Emu.ctx / Emu.WIDTH / Emu.HEIGHT   180x164 の画面 (CanvasRenderingContext2D)
 *   Emu.state                          { up, down, left, right, tl, tr, bl, br } 押下状態
 *   Emu.on('button', (name, down) => {})   十字キー4方向 + 4ボタンの押下/解放
 *   Emu.on('scroll', (dx, dy, info) => {}) 十字パッド上のドラッグ量（画面ピクセル単位）
 *                                          info.inertia: 指を離した後の慣性分なら true
 *
 * 十字パッド: タップ/長押し = 方向入力、なぞる = スクロール。
 */
(() => {
  const WIDTH = 180, HEIGHT = 164;

  // skin.webp (1080x1920) 上の各パーツの矩形 [x, y, w, h]
  const SKIN = { w: 1080, h: 1920 };
  const RECT = {
    screen: [76, 57, 931, 851],
    dpad:   [108, 1006, 874, 872],
    tl:     [84, 1004, 292, 280],
    tr:     [711, 1004, 292, 280],
    bl:     [84, 1572, 292, 290],
    br:     [711, 1572, 292, 290],
  };

  const DRAG_THRESHOLD = 0.07;   // パッド幅に対する割合。これ以上動いたらスクロール扱い
  const DEAD_ZONE = 0.09;        // 中心の無反応半径（パッド幅に対する割合）
  const FRICTION = 0.0045;       // 慣性スクロールの減衰 (1/ms)
  const VOLUME = 0.5;            // 操作音全体の音量 (0〜1)

  const device = document.getElementById('device');
  const canvas = document.getElementById('screen');
  const dpad = document.getElementById('dpad');
  const finger = dpad.querySelector('.finger');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const state = { up: false, down: false, left: false, right: false, tl: false, tr: false, bl: false, br: false };
  const listeners = { button: [], scroll: [] };
  const emit = (type, ...args) => listeners[type].forEach(fn => fn(...args));

  function place(el, [x, y, w, h], clipSkin) {
    const s = el.style;
    s.left = x / SKIN.w * 100 + '%';
    s.top = y / SKIN.h * 100 + '%';
    s.width = w / SKIN.w * 100 + '%';
    s.height = h / SKIN.h * 100 + '%';
    if (clipSkin) {
      s.backgroundSize = `${SKIN.w / w * 100}% ${SKIN.h / h * 100}%`;
      s.backgroundPosition = `${x / (SKIN.w - w) * 100}% ${y / (SKIN.h - h) * 100}%`;
    }
  }
  place(canvas, RECT.screen);
  place(dpad, RECT.dpad);

  // ---- クリック音（Web Audio で合成。音声ファイル不要） ----
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audio = null, noiseBuf = null;

  function unlockAudio() {          // ブラウザの制約で、最初のユーザー操作時に有効化する
    if (!AudioCtx) return;
    if (!audio) {
      audio = new AudioCtx({ latencyHint: 'interactive' });
      noiseBuf = audio.createBuffer(1, audio.sampleRate * 0.05, audio.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (audio.state !== 'running') audio.resume();
  }
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    addEventListener(type, unlockAudio, { capture: true, passive: true });
  }

  function click(down, dull) {   // dull: 十字パッド用の鈍い「コトッ」
    if (!audio || audio.state !== 'running') return;
    const t = audio.currentTime;
    const vol = (down ? 0.5 : 0.22) * (dull ? 0.5 : 1);   // 離すときは小さく低めに。十字はボタンの半分
    const out = audio.createGain();
    out.gain.value = VOLUME;
    out.connect(audio.destination);

    // 「カチッ」の硬い成分：帯域を絞ったノイズを数msで減衰
    const noise = audio.createBufferSource();
    noise.buffer = noiseBuf;
    const bp = audio.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = dull ? (down ? 380 : 300) : (down ? 3800 : 2600);
    bp.Q.value = dull ? 0.7 : 1.2;
    const ng = audio.createGain();
    ng.gain.setValueAtTime(dull ? vol * 0.5 : vol, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + (dull ? 0.03 : down ? 0.018 : 0.012));
    noise.connect(bp).connect(ng).connect(out);
    noise.start(t);
    noise.stop(t + 0.04);

    // 筐体に当たる低い「コッ」
    const osc = audio.createOscillator();
    osc.type = dull ? 'sine' : 'triangle';
    const len = dull ? 0.06 : 0.03;
    osc.frequency.setValueAtTime(dull ? (down ? 150 : 120) : (down ? 900 : 600), t);
    osc.frequency.exponentialRampToValueAtTime(dull ? (down ? 60 : 55) : (down ? 220 : 180), t + len * 0.8);
    const og = audio.createGain();
    og.gain.setValueAtTime(vol * (dull ? 1 : 0.5), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + len);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + len + 0.005);
  }

  const DPAD = new Set(['up', 'down', 'left', 'right']);

  function setButton(name, down, silent) {
    if (state[name] === down) return;
    state[name] = down;
    unlockAudio();
    if (!silent) click(down, DPAD.has(name));
    if (down && navigator.vibrate) navigator.vibrate(8);
    emit('button', name, down);
  }

  // ---- 4つのボタン ----
  const btnEls = {};
  document.querySelectorAll('.btn').forEach(el => {
    const name = el.dataset.btn;
    btnEls[name] = el;
    place(el, RECT[name], true);
    const pointers = new Set();
    const sync = () => {
      el.classList.toggle('down', pointers.size > 0 || keysDown.has(name));
      setButton(name, pointers.size > 0 || keysDown.has(name));
    };
    el._sync = sync;
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch {}
      pointers.add(e.pointerId);
      sync();
    });
    const up = e => { pointers.delete(e.pointerId); sync(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  });

  // ---- 十字パッド ----
  const arms = {};
  ['up', 'down', 'left', 'right'].forEach(d => arms[d] = dpad.querySelector('.arm.' + d));
  const keysDown = new Set();
  let touchDir = null;

  function syncDirs(silent) {
    for (const d in arms) {
      const on = touchDir === d || keysDown.has(d);
      arms[d].classList.toggle('on', on);
      setButton(d, on, silent);
    }
  }

  const screenScale = () => canvas.getBoundingClientRect().width / WIDTH; // CSS px / 画面px

  function dirAt(e) {
    const r = dpad.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    if (Math.hypot(nx, ny) < DEAD_ZONE) return null;
    return Math.abs(nx) > Math.abs(ny) ? (nx < 0 ? 'left' : 'right') : (ny < 0 ? 'up' : 'down');
  }

  let active = null;      // { id, startX, startY, lastX, lastY, lastT, vx, vy, scrolling }
  let inertiaRaf = 0;

  function stopInertia() { cancelAnimationFrame(inertiaRaf); inertiaRaf = 0; }

  function startInertia(vx, vy) {   // vx, vy: 画面px/ms
    let last = performance.now();
    const step = now => {
      const dt = Math.min(now - last, 50); last = now;
      const k = Math.exp(-FRICTION * dt);
      emit('scroll', vx * dt, vy * dt, { inertia: true });
      vx *= k; vy *= k;
      inertiaRaf = Math.hypot(vx, vy) > 0.01 ? requestAnimationFrame(step) : 0;
    };
    inertiaRaf = requestAnimationFrame(step);
  }

  function moveFinger(e) {
    const r = dpad.getBoundingClientRect();
    finger.style.left = (e.clientX - r.left) / r.width * 100 + '%';
    finger.style.top = (e.clientY - r.top) / r.height * 100 + '%';
  }

  dpad.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (active) return;
    stopInertia();
    try { dpad.setPointerCapture(e.pointerId); } catch {}
    active = { id: e.pointerId, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
               lastT: e.timeStamp, vx: 0, vy: 0, scrolling: false };
    touchDir = dirAt(e);
    syncDirs();
  });

  dpad.addEventListener('pointermove', e => {
    if (!active || e.pointerId !== active.id) return;
    const a = active;
    if (!a.scrolling) {
      const thr = dpad.getBoundingClientRect().width * DRAG_THRESHOLD;
      if (Math.hypot(e.clientX - a.startX, e.clientY - a.startY) < thr) return;
      a.scrolling = true;                 // なぞり始めたら方向入力は解除してスクロールへ
      a.lastX = e.clientX; a.lastY = e.clientY; a.lastT = e.timeStamp;
      touchDir = null;
      syncDirs(true);                     // スクロールへの切り替えは無音
      dpad.classList.add('scrolling');
    }
    const s = screenScale();
    const dx = (e.clientX - a.lastX) / s, dy = (e.clientY - a.lastY) / s;
    const dt = Math.max(e.timeStamp - a.lastT, 1);
    a.vx = a.vx * 0.6 + (dx / dt) * 0.4;
    a.vy = a.vy * 0.6 + (dy / dt) * 0.4;
    a.lastX = e.clientX; a.lastY = e.clientY; a.lastT = e.timeStamp;
    moveFinger(e);
    if (dx || dy) emit('scroll', dx, dy, { inertia: false });
  });

  function endPad(e) {
    if (!active || e.pointerId !== active.id) return;
    const a = active;
    active = null;
    touchDir = null;
    syncDirs();
    dpad.classList.remove('scrolling');
    // 指を止めてから離した場合は慣性なし
    if (a.scrolling && e.type === 'pointerup' && e.timeStamp - a.lastT < 60 && Math.hypot(a.vx, a.vy) > 0.05) {
      startInertia(a.vx, a.vy);
    }
  }
  dpad.addEventListener('pointerup', endPad);
  dpad.addEventListener('pointercancel', endPad);
  dpad.addEventListener('lostpointercapture', endPad);

  // マウスホイール / トラックパッド（PCでの確認用）
  dpad.addEventListener('wheel', e => {
    e.preventDefault();
    stopInertia();
    const s = screenScale();
    emit('scroll', -e.deltaX / s, -e.deltaY / s, { inertia: false });
  }, { passive: false });

  // ---- キーボード（PCでの確認用）: 矢印 = 十字、Q W = 上段、A S = 下段 ----
  const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
                 q: 'tl', w: 'tr', a: 'bl', s: 'br' };
  const onKey = down => e => {
    const name = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!name || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    down ? keysDown.add(name) : keysDown.delete(name);
    name in arms ? syncDirs() : btnEls[name]._sync();
  };
  addEventListener('keydown', onKey(true));
  addEventListener('keyup', onKey(false));
  addEventListener('blur', () => {
    keysDown.clear();
    syncDirs();
    for (const n in btnEls) btnEls[n]._sync();
  });

  // ---- ブラウザ既定のジェスチャを抑止 ----
  for (const type of ['contextmenu', 'gesturestart', 'dblclick', 'selectstart']) {
    document.addEventListener(type, e => e.preventDefault());
  }
  device.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  window.Emu = {
    WIDTH, HEIGHT, canvas, ctx, state,
    on(type, fn) { listeners[type].push(fn); return () => listeners[type].splice(listeners[type].indexOf(fn), 1); },
  };
})();
