// Draws a sample "photo" of a ginger cat on a plain background, for trying the
// Studio without a photo of your own.
export async function makeSamplePhoto() {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 900;
  const g = c.getContext('2d');

  const bg = g.createLinearGradient(0, 0, 0, 900);
  bg.addColorStop(0, '#efeae2');
  bg.addColorStop(0.78, '#e4ddd2');
  bg.addColorStop(0.8, '#ebe5db');
  bg.addColorStop(1, '#e6dfd4');
  g.fillStyle = bg;
  g.fillRect(0, 0, 1200, 900);

  g.save();
  g.filter = 'blur(10px)';
  g.fillStyle = 'rgba(70, 50, 30, 0.16)';
  g.beginPath();
  g.ellipse(590, 738, 320, 22, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();

  const ginger = '#d98b3c', dark = '#b5672a', white = '#f7f1e8', pink = '#eea39b';
  const ell = (x, y, rx, ry, color) => { g.fillStyle = color; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); };
  const rrect = (x, y, w, h, r, color) => { g.fillStyle = color; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  const tri = (pts, color) => { g.fillStyle = color; g.beginPath(); g.moveTo(...pts[0]); g.lineTo(...pts[1]); g.lineTo(...pts[2]); g.closePath(); g.fill(); };
  const stroke = (pts, width, color) => {
    g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(...pts[0]);
    if (pts.length === 4) g.bezierCurveTo(...pts[1], ...pts[2], ...pts[3]);
    else g.lineTo(...pts[1]);
    g.stroke();
  };

  // Tail
  stroke([[380, 470], [250, 440], [205, 300], [262, 214]], 32, ginger);
  stroke([[214, 330], [207, 290], [222, 250], [262, 214]], 32, dark);

  // Legs and paws
  rrect(372, 540, 54, 192, 26, ginger);
  rrect(442, 548, 50, 184, 24, dark);
  rrect(688, 540, 50, 192, 24, ginger);
  rrect(752, 548, 48, 184, 24, ginger);
  for (const x of [399, 467, 713, 776]) ell(x, 726, 31, 13, white);

  // Body, neck, chest
  ell(578, 505, 248, 116, ginger);
  ell(780, 430, 82, 96, ginger);
  ell(770, 525, 70, 84, white);
  for (const x of [470, 540, 610, 680]) stroke([[x, 395], [x + 12, 425], [x + 10, 455], [x - 4, 480]], 14, dark);

  // Head
  tri([[768, 304], [786, 172], [848, 256]], ginger);
  tri([[848, 256], [916, 168], [928, 292]], ginger);
  tri([[784, 290], [792, 205], [832, 260]], pink);
  tri([[862, 262], [908, 198], [914, 284]], pink);
  ell(836, 352, 102, 98, ginger);
  for (const x of [808, 830, 852]) stroke([[x, 262], [x + 2, 290]], 9, dark);
  ell(906, 398, 52, 37, white);
  ell(886, 340, 13, 16, '#2b2a28');
  ell(890, 334, 4, 4, '#ffffff');
  tri([[934, 370], [954, 370], [944, 384]], pink);
  stroke([[944, 384], [940, 400]], 3, '#7a4a3a');

  g.strokeStyle = 'rgba(250, 248, 244, 0.9)';
  g.lineWidth = 2.5;
  for (const [y1, y2] of [[392, 376], [400, 402], [408, 426]]) {
    g.beginPath(); g.moveTo(924, y1); g.lineTo(1006, y2); g.stroke();
  }

  return new Promise((r) => c.toBlob(r, 'image/png'));
}
