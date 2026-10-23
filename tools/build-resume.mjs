// Renders resume/resume.html to assets/Vlad_Bondarenko_Resume.pdf with Playwright's Chromium.
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL('resume/resume.html').href);
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: 'assets/Vlad_Bondarenko_Resume.pdf',
  preferCSSPageSize: true,
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font:8px Arial,sans-serif;color:#555;text-align:right;padding-right:0.65in">Vlad Bondarenko • <span class="pageNumber"></span></div>',
});
await browser.close();
