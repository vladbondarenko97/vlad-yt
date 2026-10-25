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
  await expect(page).toHaveTitle(/^Vlad Bondarenko \| QA Automation Engineer/);
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
  // On a GPU-less runner the scene renders in software and each fill/click takes 5-7 s, so five steps
  // overrun the default 30 s (seen in CI: 30.8 s). The form isn't slow; the page around it is.
  test.describe.configure({ timeout: 90_000 });
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
    await expect(page.locator('[data-form-status]')).toContainText('vbondarenko@my.stlcc.edu');
  });

  test('copy button puts the address on the clipboard', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permission is Chromium-only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(LOW);
    // Stable selector: the button's accessible name changes to "Copied", so a by-name locator would lose it.
    const copy = page.locator('[data-copy]');
    await copy.click();
    await expect(copy).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('vbondarenko@my.stlcc.edu');
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

test('SEO: headshot loads, Person/ProfilePage JSON-LD is valid, profiles are rel=me', async ({ page, request }) => {
  await page.goto(LOW);
  const portrait = page.getByRole('img', { name: /^Vlad Bondarenko/ });
  await expect(portrait).toBeVisible();
  expect(await portrait.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  const graph = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent())['@graph'];
  const person = graph.find((n) => n['@type'] === 'Person');
  expect(graph.find((n) => n['@type'] === 'ProfilePage').mainEntity['@id']).toBe(person['@id']);
  expect((await request.get(new URL(person.image.url).pathname)).status()).toBe(200);
  for (const url of person.sameAs) await expect(page.locator(`a[rel~="me"][href="${url}"]`)).toHaveCount(1);
});

test('engineering page: loads cleanly, linked from the home page, no serious a11y violations', async ({ page }) => {
  const problems = watchErrors(page);
  await page.goto(LOW);
  await page.getByRole('link', { name: 'How I engineer' }).click();
  await expect(page).toHaveURL(/\/engineering\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('How I engineer');
  for (const id of ['test-strategy', 'design', 'root-causes', 'agents', 'leadership', 'before-ai']) {
    await expect(page.locator(`#${id} h2`)).toBeVisible();
  }
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(violations.filter((v) => ['serious', 'critical'].includes(v.impact)).map((v) => v.id)).toEqual([]);
});
