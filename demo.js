/*
 * demo.js — 入力確認用のデモ画面（ここを実際のコアや描画に差し替える）
 *
 *   十字タップ/長押し : キャラ移動        十字をなぞる : マップをスクロール
 *   左上 : 配色切替   右上 : キャラ位置へ戻る   左下 : 目印を置く   右下 : 目印を消す
 */
(() => {
  const { ctx, WIDTH: W, HEIGHT: H, state } = Emu;
  const TILE = 16, SPEED = 64; // px/s

  const THEMES = [
    { a: '#0a5cff', b: '#1f6dff', dot: '#7fb0ff', player: '#ffffff', mark: '#ffd84a', hud: '#001a66' },
    { a: '#9bbc0f', b: '#8bac0f', dot: '#306230', player: '#0f380f', mark: '#0f380f', hud: '#0f380f' },
    { a: '#222034', b: '#2b2944', dot: '#5b6ee1', player: '#fbf236', mark: '#d95763', hud: '#000000' },
    { a: '#e8e4d8', b: '#dcd7c8', dot: '#a09a88', player: '#d04a3a', mark: '#3a6ad0', hud: '#3a3a3a' },
  ];
  let theme = 0;

  const player = { x: 0, y: 0, face: 'down' };
  const cam = { x: -W / 2 + 4, y: -H / 2 + 4 };   // 画面左上のワールド座標
  let follow = true;
  const marks = new Set();

  Emu.on('scroll', (dx, dy) => {      // 指の動きにマップがついてくる
    cam.x -= dx; cam.y -= dy;
    follow = false;
  });

  Emu.on('button', (name, down) => {
    if (!down) return;
    if (name === 'tl') theme = (theme + 1) % THEMES.length;
    if (name === 'tr') follow = true;
    if (name === 'bl') marks.add(Math.floor((player.x + 4) / TILE) + ',' + Math.floor((player.y + 4) / TILE));
    if (name === 'br') marks.clear();
  });

  // 3x5 ドットフォント（数字とマイナス）
  const FONT = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
    4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001',
    8: '111101111101111', 9: '111101111001111', '-': '000000111000000', ' ': '000000000000000',
  };
  function text(str, x, y, color) {
    ctx.fillStyle = color;
    for (const ch of String(str)) {
      const g = FONT[ch] || FONT[' '];
      for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(x + i % 3, y + (i / 3 | 0), 1, 1);
      x += 4;
    }
  }

  const hash = (x, y) => { let h = x * 374761393 + y * 668265263; h = (h ^ (h >> 13)) * 1274126177; return (h ^ (h >> 16)) >>> 0; };

  function update(dt) {
    const dx = (state.right ? 1 : 0) - (state.left ? 1 : 0);
    const dy = (state.down ? 1 : 0) - (state.up ? 1 : 0);
    if (dx || dy) {
      player.x += dx * SPEED * dt;
      player.y += dy * SPEED * dt;
      player.face = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
      follow = true;
    }
    if (follow) {
      const k = 1 - Math.exp(-10 * dt);
      cam.x += (player.x + 4 - W / 2 - cam.x) * k;
      cam.y += (player.y + 4 - H / 2 - cam.y) * k;
    }
  }

  function draw() {
    const t = THEMES[theme];
    const cx = Math.round(cam.x), cy = Math.round(cam.y);

    const tx0 = Math.floor(cx / TILE), ty0 = Math.floor(cy / TILE);
    for (let ty = ty0; ty * TILE < cy + H; ty++) {
      for (let tx = tx0; tx * TILE < cx + W; tx++) {
        const sx = tx * TILE - cx, sy = ty * TILE - cy;
        ctx.fillStyle = (tx + ty) & 1 ? t.a : t.b;
        ctx.fillRect(sx, sy, TILE, TILE);
        const h = hash(tx, ty);
        if (h % 5 === 0) {                       // まばらな地面の模様
          ctx.fillStyle = t.dot;
          ctx.fillRect(sx + 3 + (h >> 4) % 9, sy + 3 + (h >> 8) % 9, 2, 2);
        }
        if (marks.has(tx + ',' + ty)) {
          ctx.fillStyle = t.mark;
          ctx.fillRect(sx + 5, sy + 5, 6, 6);
          ctx.fillStyle = (tx + ty) & 1 ? t.a : t.b;
          ctx.fillRect(sx + 7, sy + 7, 2, 2);
        }
      }
    }

    // キャラ
    const px = Math.round(player.x) - cx, py = Math.round(player.y) - cy;
    ctx.fillStyle = t.hud;
    ctx.fillRect(px - 1, py - 1, 10, 10);
    ctx.fillStyle = t.player;
    ctx.fillRect(px, py, 8, 8);
    ctx.fillStyle = t.hud;
    const eye = { up: [[1, 1], [5, 1]], down: [[1, 5], [5, 5]], left: [[1, 2], [1, 5]], right: [[5, 2], [5, 5]] }[player.face];
    for (const [ex, ey] of eye) ctx.fillRect(px + ex, py + ey, 2, 2);

    // HUD: 座標
    const label = Math.round(player.x) + ' ' + Math.round(player.y);
    ctx.fillStyle = t.hud;
    ctx.fillRect(2, 2, label.length * 4 + 3, 9);
    text(label, 4, 4, t.a);

    // HUD: 入力表示
    const ox = W - 31, oy = H - 19;
    ctx.fillStyle = t.hud;
    ctx.fillRect(ox - 2, oy - 2, 31, 19);
    const cell = (x, y, on) => { ctx.fillStyle = on ? t.player : t.b; ctx.fillRect(ox + x, oy + y, 4, 4); };
    cell(5, 0, state.up); cell(5, 10, state.down); cell(0, 5, state.left); cell(10, 5, state.right);
    cell(17, 2, state.tl); cell(23, 2, state.tr); cell(17, 9, state.bl); cell(23, 9, state.br);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
