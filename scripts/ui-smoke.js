// UI smoke test: drive the game in headless Chrome, exercise the main flows,
// and capture screenshots. Requires the static server on :8000.
// Usage: node scripts/ui-smoke.js

import { chromium } from 'playwright-core';
import fs from 'node:fs';

const OUT = '/opt/cursor/artifacts/screenshots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: '/usr/local/bin/google-chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto('http://localhost:8000/?seed=smoke-1', { waitUntil: 'networkidle' });
await page.waitForSelector('.claim-card');
console.log('loaded. market cards:', await page.locator('#claims-list .claim-card').count());
await page.screenshot({ path: `${OUT}/01-market.png` });

// Buy the first affordable claim
await page.locator('#claims-list .claim-card button.primary').first().click();
await page.locator('#claims-tabs button[data-tab="portfolio"]').click();
await page.waitForSelector('#claims-list .claim-card');
console.log('bought a claim; portfolio shows it.');

// Investigate it
await page.getByRole('button', { name: /Investigate/ }).first().click();
console.log('investigated:', await page.locator('#toast').textContent());

// Forge modal
await page.getByRole('button', { name: /Forge evidence/ }).first().click();
await page.waitForSelector('.modal');
await page.screenshot({ path: `${OUT}/02-forge-modal.png` });
await page.locator('.modal .options button').first().click();

// End day to refresh actions, then sell
await page.locator('#btn-endday').click();
await page.locator('#claims-tabs button[data-tab="portfolio"]').click();
await page.getByRole('button', { name: /^Sell…$/ }).first().click();
await page.waitForSelector('.modal');
await page.locator('.modal .options button:not([disabled])').first().click();
console.log('sold:', await page.locator('#toast').textContent());

// Run 10 days and check the chronicle grows
for (let i = 0; i < 10; i++) await page.locator('#btn-endday').click();
const chronEntries = await page.locator('.chron-entry').count();
console.log('chronicle entries after 12 days:', chronEntries);
await page.screenshot({ path: `${OUT}/03-chronicle.png` });

// Network view + NPC inspector
await page.locator('#main-tabs button[data-tab="network"]').click();
await page.locator('#network-claim').selectOption({ index: 1 });
await page.waitForTimeout(300);
// District clusters sit on a ring around the canvas center; probe until we hit a node.
const box = await page.locator('#network-canvas').boundingBox();
for (const angle of [0, 72, 144, 216, 288]) {
  const r = Math.min(box.width, box.height) * 0.32;
  const x = box.width / 2 + r * Math.cos(((angle - 90) * Math.PI) / 180);
  const y = box.height / 2 + r * Math.sin(((angle - 90) * Math.PI) / 180);
  await page.locator('#network-canvas').click({ position: { x, y } });
  if (await page.locator('#npc-inspector:not([hidden])').count()) break;
}
await page.waitForSelector('#npc-inspector:not([hidden])', { timeout: 5000 });
console.log('npc inspector shows:', (await page.locator('#npc-inspector h3').textContent()).trim());
await page.screenshot({ path: `${OUT}/04-network.png` });

// Debug view
await page.locator('#main-tabs button[data-tab="debug"]').click();
const debugText = await page.locator('#debug-view').textContent();
console.log('debug view has event queue:', debugText.includes('Event queue'));
await page.screenshot({ path: `${OUT}/05-debug.png` });

// Claim inspector modal from chronicle
await page.locator('#main-tabs button[data-tab="chronicle"]').click();
const clickable = page.locator('.chron-entry .txt[title]').last();
if (await clickable.count()) {
  await clickable.click();
  await page.waitForSelector('.modal');
  await page.screenshot({ path: `${OUT}/06-claim-inspect.png` });
  await page.keyboard.press('Escape');
}

if (errors.length) {
  console.error('\nERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('\nUI smoke test passed with no console/page errors.');
}
await browser.close();
