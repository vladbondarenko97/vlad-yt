import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Functional tests pin the low render tier: CI runners have no GPU, so full-quality shaders crawl on
// software WebGL and make scroll/click tests time out. The default tier is still exercised by the load test.
const LOW = '/?quality=low';

// Collect everything the page complains about while a test runs.
function watchErrors(page) {
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  page.on('requestfailed', (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));
  return problems;
}

test('loads cleanly: right title, heading, no errors, no failed requests', async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Vlad Bondarenko');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Vlad Bondarenko');
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
});

test('every stop has a section, and every gauge link points at one', async ({ page }) => {
  await page.goto('/');
  const sections = await page.locator('section[data-stop]').evaluateAll((els) => els.map((e) => e.id));
  const links = await page.locator('[data-gauge-stop] a').evaluateAll((els) => els.map((a) => a.getAttribute('href').slice(1)));
  expect(sections).toHaveLength(10);
  expect(links).toEqual(sections);
});

test('scrolling moves the gauge: Sun at the top, Earth mid-way, Center at the bottom', async ({ page }) => {
  await page.goto(LOW);
  const place = page.locator('[data-gauge="place"]');
  await expect(place).toHaveText('Sun');
  await page.locator('#earth').scrollIntoViewIfNeeded();
  await expect(place).toHaveText('Earth');
  await page.locator('#contact').scrollIntoViewIfNeeded();
  await expect(place).toHaveText('Center');
});

test('the quality override is honoured (?quality=low)', async ({ page }) => {
  await page.goto('/?quality=low');
  await page.waitForFunction(() => window.__journey || document.documentElement.classList.contains('no-webgl'));
  const tier = await page.evaluate(() => window.__journey?.tier());
  test.skip(tier === undefined, 'no WebGL on this runner, covered by the fallback test');
  expect(tier).toBe('low');
});

test('without WebGL the page degrades to a readable résumé', async ({ page }) => {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/.test(type) ? null : real.call(this, type, ...rest);
    };
  });
  const problems = watchErrors(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/no-webgl/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Six years of testing/ })).toBeVisible();
  // three.js logs its own "Error creating WebGL context" on this handled path; anything else is a real bug.
  expect(problems.filter((p) => !p.includes('Error creating WebGL context'))).toEqual([]);
});

test('reduced motion: page still loads and works', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = watchErrors(page);
  await page.goto(LOW);
  await page.locator('#contact').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-gauge="place"]')).toHaveText('Center');
  expect(problems).toEqual([]);
});

test.describe('contact', () => {
  test('empty form is blocked by validation', async ({ page }) => {
    await page.goto(LOW);
    await page.getByRole('button', { name: 'Open email draft' }).click();
    await expect(page.locator('[data-form-status]')).toBeEmpty();
  });

  test('a valid form reports that the email app should open', async ({ page }) => {
    await page.goto(LOW);
    await page.getByLabel('Your name').fill('Ada Lovelace');
    await page.getByLabel('Your email').fill('ada@example.com');
    await page.getByLabel('Message').fill('We should talk.');
    await page.getByRole('button', { name: 'Open email draft' }).click();
    await expect(page.locator('[data-form-status]')).toContainText('contactvlad1k@gmail.com');
  });

  test('copy button puts the address on the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permission is Chromium-only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(LOW);
    // Stable selector: the button's accessible name changes to "Copied", so a by-name locator would lose it.
    const copy = page.locator('[data-copy]');
    await copy.click();
    await expect(copy).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('contactvlad1k@gmail.com');
  });
});

test('résumé PDF is served as a PDF', async ({ request }) => {
  const res = await request.get('/assets/Vlad_Bondarenko_Resume.pdf');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('pdf');
});

test('no serious accessibility violations (axe, WCAG A/AA)', async ({ page }) => {
  await page.goto(LOW);
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const serious = violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
});
