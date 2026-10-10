// Records docs/demo.gif: a slow scroll from the Sun to the center of the Earth.
// Needs ffmpeg. Run with the site served on :8080 (`npm run serve`): node tools/record-demo.mjs
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';

const tmp = 'test-results/demo';
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: tmp, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto('http://localhost:8080/?quality=high');
await page.waitForFunction(() => window.__journey);
await page.waitForTimeout(2500);

// Ease the scroll over 24 s so every stop gets a moment on screen.
await page.evaluate(() => new Promise((done) => {
  const max = document.documentElement.scrollHeight - innerHeight;
  const start = performance.now(), ms = 24000;
  const tick = (now) => {
    const t = Math.min((now - start) / ms, 1);
    // 'instant': the page's CSS has smooth scrolling, which would swallow every frame's scrollTo.
    scrollTo({ top: max * (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) ** 2), behavior: 'instant' });
    t < 1 ? requestAnimationFrame(tick) : done();
  };
  requestAnimationFrame(tick);
}));
await page.waitForTimeout(1500);
await context.close();
await browser.close();

const webm = readdirSync(tmp).find((f) => f.endsWith('.webm'));
mkdirSync('docs', { recursive: true });
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${tmp}/${webm}`,
  // Speed up 1.4x and keep it small: README GIFs over ~8 MB load slowly on GitHub.
  '-vf', 'setpts=0.7*PTS,fps=10,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  'docs/demo.gif']);
console.log('wrote docs/demo.gif');
