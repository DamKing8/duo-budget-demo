#!/usr/bin/env node
/* Spending UI checks. Personal build: no screenshots and no network.
   Demo-data build: Chloe & Jack preview screenshots only. */
'use strict';
var fs = require('fs');
var http = require('http');
var path = require('path');
var playwright = require('playwright-core');
var shotGuard = require('./tools/shot-guard');

var ROOT = __dirname;
var SHOTS = '/opt/cursor/artifacts/screenshots';
var failed = 0;

function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL ' + msg); }
}

function serve(dir) {
  var root = path.resolve(dir);
  var server = http.createServer(function (req, res) {
    var u = new URL(req.url, 'http://127.0.0.1');
    var rel = decodeURIComponent(u.pathname);
    if (rel === '/') rel = '/index.html';
    var file = path.resolve(root, '.' + rel);
    if (file.indexOf(root + path.sep) !== 0 && file !== root) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, function (err, buf) {
      if (err) { res.writeHead(404); res.end('missing'); return; }
      var types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon' };
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () { resolve({ server: server, url: 'http://127.0.0.1:' + server.address().port + '/index.html' }); });
  });
}

async function watch(page, bag) {
  page.on('console', function (msg) { if (msg.type() === 'error') bag.errors.push(msg.text()); });
  page.on('pageerror', function (err) { bag.errors.push(String(err)); });
  page.on('request', function (req) {
    var host = '';
    try { host = new URL(req.url()).host; } catch (e) { host = req.url(); }
    if (host.indexOf('127.0.0.1') !== 0) bag.external.push(req.url());
  });
}

async function personal(browser, url) {
  var bag = { errors: [], external: [] };
  var page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  await watch(page, bag);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-test="spent-card"]');
  assert((await page.locator('#spentCardLbl').innerText()).indexOf('Spent this') === 0, 'home card title');

  await page.click('[data-test="add-spending"]');
  await page.waitForSelector('[data-test="sp-amt"]');
  await page.fill('[data-test="sp-amt"]', '45.20');
  await page.click('[data-test="more-lines"]');
  await page.click('.line-pick >> text=Groceries');
  await page.click('[data-test="sp-save"]');
  await page.waitForSelector('[data-test="undo-add"]');
  var toast = await page.locator('#toast').innerText();
  assert(toast.indexOf('Added') >= 0 && toast.indexOf('Groceries') >= 0, 'added toast: ' + toast);

  await page.locator('[data-test="spent-total"]').scrollIntoViewIfNeeded();
  await page.click('[data-test="spent-total"]');
  await page.waitForSelector('[data-test="spend-list"] .item[data-spend]');
  await page.click('[data-test="spend-list"] .item[data-spend]');
  await page.fill('[data-test="sp-amt"]', '50');
  await page.click('[data-test="sp-save"]');
  await page.waitForSelector('[data-test="undo-add"]');

  var row = page.locator('[data-test="spend-list"] .item[data-spend]').first();
  await row.scrollIntoViewIfNeeded();
  var box = await row.boundingBox();
  await page.mouse.move(box.x + box.width - 24, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 8, box.y + box.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForSelector('[data-test="undo-spend"]');
  await page.waitForTimeout(400);
  await page.click('[data-test="undo-spend"]');
  await page.waitForSelector('[data-test="spend-list"] .item[data-spend]');

  await page.click('[data-test="spent-add"]');
  await page.fill('[data-test="sp-amt"]', '12.40');
  await page.click('[data-test="more-lines"]');
  await page.click('.line-pick >> text=Groceries');
  await page.check('[data-test="sp-refund"]');
  await page.click('[data-test="sp-save"]');
  await page.waitForTimeout(200);

  await page.click('nav.tabs button[data-v="budget"]');
  var maths = await page.evaluate(function () {
    var S = window.__duo.state();
    var win = window.__duo.payWindow(S.cycle, S.payDate);
    var g = S.items.filter(function (i) { return i.name === 'Groceries'; })[0];
    var sum = 0;
    S.spends.forEach(function (e) { if (e.itemId === g.id && window.__duo.entryInWindow(e.on, win)) sum += +e.amount || 0; });
    sum = Math.round(sum * 100) / 100;
    var el = document.querySelector('[data-cat="expenses"] .item[data-id="' + g.id + '"] [data-test="line-spent"]');
    return { sum: sum, planned: g.amount, text: el ? el.textContent : '' };
  });
  assert(Math.abs(maths.sum - 37.6) < 0.001, 'independent groceries sum ' + maths.sum);
  assert(maths.text.indexOf('Spent') >= 0 && maths.text.indexOf('460') >= 0, 'budget line wording: ' + maths.text);
  assert(maths.text.toLowerCase().indexOf('transaction') < 0 && maths.text.indexOf('Over budget') < 0, 'banned wording on the line');

  await page.click('nav.tabs button[data-v="cycle"]');
  await page.click('#seg button[data-c="week"]');
  await page.click('nav.tabs button[data-v="dash"]');
  assert((await page.locator('#spentCardLbl').innerText()).indexOf('week') >= 0, 'weekly card');
  await page.click('nav.tabs button[data-v="cycle"]');
  await page.click('#seg button[data-c="month"]');
  await page.click('nav.tabs button[data-v="dash"]');
  assert((await page.locator('#spentCardLbl').innerText()).indexOf('month') >= 0, 'monthly card');
  await page.click('nav.tabs button[data-v="cycle"]');
  await page.click('#seg button[data-c="fortnight"]');
  await page.click('#seg button[data-c="year"]');
  await page.click('nav.tabs button[data-v="budget"]');
  var yearLine = await page.locator('[data-cat="expenses"] [data-test="line-spent"]').first().innerText();
  assert(yearLine.indexOf('pay cycle') >= 0, 'year view still uses the pay cycle: ' + yearLine);

  await page.evaluate(function () {
    var S = window.__duo.state();
    var wins = window.__duo.trWins();
    var prev = wins[wins.length - 2];
    var d = prev.start;
    var on = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var g = S.items.filter(function (i) { return i.name === 'Groceries'; })[0];
    S.spends.push({ id: 'prev1', itemId: g.id, lineName: g.name, cat: 'expenses', owner: 'J', paidBy: 'D', amount: 20, on: on, note: '', at: 9 });
    window.__duoRerender();
  });
  await page.click('[data-test="budget-trends"]');
  await page.waitForSelector('#trSub');
  var sub = await page.locator('#trSub').innerText();
  assert(sub.indexOf("from the spending you've recorded") >= 0, 'trends subtitle: ' + sub);

  var migrated = await page.evaluate(function () {
    var state = { v: 3, names: { D: 'Chloe', N: 'Jack' }, items: [{ id: 'a', amount: 1, freq: 'fortnight' }], goals: [], note: 'keep' };
    var before = JSON.stringify(state);
    window.__duo.migrateV4(state);
    var restored = JSON.parse(JSON.stringify(state));
    restored.v = 3;
    delete restored.spends;
    return { same: JSON.stringify(restored) === before, v: state.v, n: state.spends.length };
  });
  assert(migrated.same && migrated.v === 4 && migrated.n === 0, 'v3 migration in the page');

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.click('nav.tabs button[data-v="dash"]');
  var side = await page.locator('#sbAddSpend').evaluate(function (el) { return getComputedStyle(el).display; });
  assert(side === 'flex', 'sidebar add spending at 768: ' + side);
  await page.click('[data-test="spent-total"]');
  var at768 = await page.locator('#v-spent').evaluate(function (el) { return getComputedStyle(el).display; });
  assert(at768 === 'block', 'spending list is one column at 768: ' + at768);

  await page.setViewportSize({ width: 1080, height: 810 });
  var at1080 = await page.locator('#v-spent').evaluate(function (el) { return getComputedStyle(el).display; });
  assert(at1080 === 'grid', 'spending list is two columns at 1080: ' + at1080);

  await page.setViewportSize({ width: 1376, height: 1032 });
  var atIpad = await page.locator('#v-spent').evaluate(function (el) { return getComputedStyle(el).display; });
  assert(atIpad === 'grid', 'spending list is two columns on iPad landscape: ' + atIpad);
  await page.evaluate(function () { window.__duoSetTheme('dark'); });
  assert((await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); })) === 'dark', 'dark theme');
  await page.evaluate(function () { window.__duoSetTheme('light'); });
  assert((await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); })) === 'light', 'light theme');

  assert(bag.external.length === 0, 'personal build made a network call: ' + bag.external.join(' '));
  assert(bag.errors.length === 0, 'console errors: ' + bag.errors.join(' | '));
  await page.close();
}

async function shots(browser, url, htmlFile) {
  shotGuard.assertDemoHtml(htmlFile);
  var bag = { errors: [], external: [] };
  var page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(15000);
  await watch(page, bag);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(function () { window.__duoSetTheme('light'); });
  await page.waitForSelector('[data-test="spent-over-line"]');
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.locator('#spentCard').scrollIntoViewIfNeeded();
  shotGuard.assertDemoHtml(htmlFile);
  await page.locator('#spentCard').screenshot({ path: path.join(SHOTS, 'phone-home-spent.png') });
  await page.click('[data-test="add-spending"]');
  await page.waitForSelector('[data-test="sp-amt"]');
  await page.screenshot({ path: path.join(SHOTS, 'phone-add-spending.png') });
  await page.click('[data-test="sheet-close"]');
  await page.click('[data-test="spent-total"]');
  await page.waitForSelector('[data-test="spent-rows"]');
  await page.screenshot({ path: path.join(SHOTS, 'phone-spending-list.png') });
  await page.click('[data-test="spent-back"]');
  await page.click('nav.tabs button[data-v="budget"]');
  var over = await page.locator('[data-cat="expenses"] [data-test="line-spent"].over').first().innerText();
  assert(over.indexOf('Running over by') >= 0, 'budget running over: ' + over);
  await page.locator('#groups .group[data-cat="expenses"]').screenshot({ path: path.join(SHOTS, 'phone-budget-over.png') });

  await page.setViewportSize({ width: 1376, height: 1032 });
  await page.click('nav.tabs button[data-v="dash"]');
  await page.locator('#spentCard').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, 'ipad-home.png') });
  await page.click('[data-test="spent-total"]');
  await page.waitForSelector('[data-test="spent-rows"]');
  await page.screenshot({ path: path.join(SHOTS, 'ipad-spending.png') });
  assert(bag.errors.length === 0, 'demo-data console errors: ' + bag.errors.join(' | '));
  await page.close();
}

async function main() {
  var personalDir = path.join(ROOT, 'build', 'personal');
  var demoDir = path.join(ROOT, 'build', 'demo-data');
  var demoHtml = path.join(demoDir, 'index.html');
  var browser = await playwright.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  var a = await serve(personalDir);
  var b = await serve(demoDir);
  try {
    await personal(browser, a.url);
    await shots(browser, b.url, demoHtml);
  } finally {
    a.server.close();
    b.server.close();
    await browser.close();
  }
  if (failed) {
    console.error(failed + ' spending assertion(s) failed');
    process.exit(1);
  }
  console.log('spending ui ok');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
