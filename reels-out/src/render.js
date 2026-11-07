const { chromium } = require('playwright'); const { spawn } = require('child_process'); const path = require('path');
(async () => {
  const [file, out, fps = '30', still] = process.argv.slice(2);
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  pg.on('pageerror', e => console.error('PAGEERR', e.message));
  await pg.goto('file://' + path.resolve(file));
  await pg.evaluate(() => document.fonts.ready);
  await pg.waitForTimeout(400);
  if (still) {
    for (const t of still.split(',')) { await pg.evaluate(t => render(+t), t); await pg.screenshot({ path: `${out}-${t}.png` }); }
    await b.close(); return;
  }
  const D = await pg.evaluate(() => DURATION); const N = Math.round(D * fps);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', fps, '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-r', fps, out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < N; i++) {
    await pg.evaluate(t => render(t), i / fps);
    const buf = await pg.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
  console.log('wrote', out, N, 'frames');
})();
