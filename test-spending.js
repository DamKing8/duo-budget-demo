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

function openPage(browser, width, height) {
  return browser.newContext({
    locale: 'en-AU',
    viewport: { width: width, height: height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce'
  }).then(function (context) {
    return context.newPage().then(function (page) {
      page.setDefaultTimeout(15000);
      return { context: context, page: page };
    });
  });
}

async function settle(page) {
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
  await page.evaluate(function () {
    return new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
  });
}

function pngSize(file) {
  var buf = fs.readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function personal(browser, url) {
  var bag = { errors: [], external: [] };
  var opened = await openPage(browser, 390, 844);
  var page = opened.page;
  await watch(page, bag);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.waitForSelector('[data-test="spent-card"]');
  assert((await page.locator('#spentCardLbl').innerText()).indexOf('Spent this') === 0, 'home card title');
  var phoneTabs = await page.locator('nav.tabs .in > button').evaluateAll(function (els) {
    return els.filter(function (el) { return getComputedStyle(el).display !== 'none'; }).length;
  });
  assert(phoneTabs === 5, 'phone keeps 5 tabs, got ' + phoneTabs);
  assert((await page.locator('#sbAddSpend').evaluate(function (el) { return getComputedStyle(el).display; })) === 'none', 'add spending stays off the phone tab bar');

  await page.click('[data-test="add-spending"]');
  await page.waitForSelector('[data-test="sp-amt"]');
  var dateShown = await page.locator('[data-test="sp-date-show"]').innerText();
  var dateIso = await page.locator('[data-test="sp-date"]').inputValue();
  var dp = dateIso.split('-');
  var au = dp[2] + '/' + dp[1] + '/' + dp[0];
  var us = dp[1] + '/' + dp[2] + '/' + dp[0];
  assert(dateShown.indexOf(au) >= 0, 'date shows en-AU ' + au + ' got ' + dateShown);
  if (dp[1] !== dp[2]) assert(dateShown.indexOf(us) < 0, 'date is not US ' + dateShown);
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
  await page.waitForSelector('[data-test="spend-refund"]');
  var refundShown = await page.locator('[data-test="spend-refund"]').first().innerText();
  assert(refundShown.indexOf('+$') >= 0 && refundShown.indexOf('Refund') >= 0 && refundShown.indexOf('-') < 0, 'refund shows as a positive amount: ' + refundShown);
  var refundTone = await page.locator('[data-test="spend-refund"]').first().evaluate(function (el) {
    var c = getComputedStyle(el).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    var stored = window.__duo.state().spends.filter(function (s) { return s.amount < 0; })[0];
    return { r: c ? +c[1] : -1, g: c ? +c[2] : -1, stored: stored ? stored.amount : null };
  });
  assert(refundTone.stored < 0, 'stored refund stays negative: ' + refundTone.stored);
  assert(refundTone.g > refundTone.r && refundTone.g > 60, 'refund uses the positive colour ' + JSON.stringify(refundTone));

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

  var widths = [{ w: 768, h: 1024, name: '768' }, { w: 1080, h: 810, name: '1080' }, { w: 1376, h: 1032, name: '1376' }];
  for (var i = 0; i < widths.length; i++) {
    var sz = widths[i];
    await page.setViewportSize({ width: sz.w, height: sz.h });
    await page.click('nav.tabs button[data-v="dash"]');
    var cardBox = await page.locator('#spentCard').boundingBox();
    assert(cardBox && cardBox.y >= 0 && cardBox.y + cardBox.height <= sz.h + 1, sz.name + ' home spent card in the grid ' + JSON.stringify(cardBox));
    if (sz.w === 768) {
      var side = await page.locator('#sbAddSpend').evaluate(function (el) {
        var s = getComputedStyle(el);
        return { display: s.display, bg: s.backgroundImage, icon: !!el.querySelector('svg') };
      });
      assert(side.display === 'flex' && side.icon && side.bg.indexOf('gradient') >= 0, 'sidebar add spending is a button at 768: ' + JSON.stringify(side));
    }
    await page.click('[data-test="spent-total"]');
    await page.waitForSelector('[data-test="spend-list"]');
    var stack = await page.evaluate(function () {
      function box(sel) { var r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }
      var display = getComputedStyle(document.querySelector('#v-spent')).display;
      return { display: display, head: box('.sp-head'), sum: box('#spentSummary'), scope: box('#spentScope'), list: box('#spendList'), vw: window.innerWidth };
    });
    assert(stack.display === 'flex', sz.name + ' spending display ' + stack.display);
    assert(stack.head.y < stack.sum.y && stack.sum.y < stack.scope.y && stack.scope.y < stack.list.y, sz.name + ' spending stacks header, summary, scope, list');
    assert(Math.abs(stack.list.x - stack.head.x) < 24, sz.name + ' list shares the header edge');
    assert(stack.list.w > stack.vw * 0.45, sz.name + ' list is not a narrow side column ' + stack.list.w);
  }
  await page.evaluate(function () { window.__duoSetTheme('dark'); });
  assert((await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); })) === 'dark', 'dark theme');
  await page.evaluate(function () { window.__duoSetTheme('light'); });
  assert((await page.evaluate(function () { return document.documentElement.getAttribute('data-theme'); })) === 'light', 'light theme');

  assert(bag.external.length === 0, 'personal build made a network call: ' + bag.external.join(' '));
  assert(bag.errors.length === 0, 'console errors: ' + bag.errors.join(' | '));
  await opened.context.close();
}

function brandStops(img) {
  var found = [];
  var re = /rgba?\((\d+),\s*(\d+),\s*(\d+)/g;
  var m;
  while ((m = re.exec(img))) found.push([+m[1], +m[2], +m[3]]);
  return found;
}
function relLum(rgb) {
  function ch(c) { c = c / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
}
function contrastRatio(fg, bg) {
  var L1 = relLum(fg), L2 = relLum(bg);
  var hi = Math.max(L1, L2), lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}
async function brandPaint(page, sel) {
  return page.locator(sel).evaluate(function (el) {
    var s = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    return { img: s.backgroundImage, color: s.color, top: r.top, bottom: r.bottom, h: r.height };
  });
}
function assertBrand(paint, theme, label) {
  var fg = paint.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  var fgRgb = fg ? [+fg[1], +fg[2], +fg[3]] : [0, 0, 0];
  var stops = brandStops(paint.img);
  assert(paint.img.indexOf('gradient') >= 0, label + ' uses the brand gradient: ' + paint.img);
  assert(paint.img.indexOf('31, 36, 48') < 0 && paint.img.indexOf('31,36,48') < 0, label + ' is not near-black: ' + paint.img);
  var worst = 99;
  stops.forEach(function (bg) {
    var ratio = contrastRatio(fgRgb, bg);
    if (ratio < worst) worst = ratio;
    console.log(label + ' ' + theme + ' contrast ' + ratio.toFixed(2) + ':1 ' + paint.color + ' on rgb(' + bg.join(', ') + ')');
  });
  assert(worst >= 4.5, label + ' contrast ' + worst.toFixed(2) + ' is below 4.5');
  if (theme === 'light') assert(fgRgb[0] > 240 && fgRgb[1] > 240 && fgRgb[2] > 240, label + ' light label ' + paint.color);
  if (theme === 'dark') assert(fgRgb[0] < 40 && fgRgb[1] < 80 && fgRgb[2] < 80, label + ' dark label stays ' + paint.color);
}

async function frameBrandButtons(page) {
  await page.evaluate(function () {
    window.scrollTo(0, 0);
    var pill = document.querySelector('#spentScope button.on');
    var add = document.querySelector('#spentAdd');
    var nav = document.querySelector('nav.tabs');
    var wide = window.innerWidth >= 768;
    var limit = wide ? window.innerHeight - 16 : (nav ? nav.getBoundingClientRect().top - 12 : window.innerHeight - 12);
    if (add && add.getBoundingClientRect().bottom > limit) window.scrollBy(0, add.getBoundingClientRect().bottom - limit);
    if (pill && pill.getBoundingClientRect().top < 8 && add) {
      var need = 8 - pill.getBoundingClientRect().top;
      var room = limit - add.getBoundingClientRect().bottom;
      if (room > 0) window.scrollBy(0, -Math.min(need, room));
    }
  });
}

async function frameSpendingList(page) {
  await page.evaluate(function () {
    window.scrollTo(0, 0);
    if (window.innerWidth >= 768) return;
    var row = document.querySelector('[data-test="spend-refund"]');
    var head = document.querySelector('.sp-head');
    var nav = document.querySelector('nav.tabs');
    if (!row || !nav) return;
    var limit = nav.getBoundingClientRect().top - 12;
    var rect = row.getBoundingClientRect();
    if (rect.bottom > limit) window.scrollBy(0, rect.bottom - limit);
    if (head && head.getBoundingClientRect().top < 4) {
      var overflow = 4 - head.getBoundingClientRect().top;
      var room = limit - row.getBoundingClientRect().bottom;
      if (room > 0) window.scrollBy(0, -Math.min(overflow, room));
    }
  });
}

async function pinAboveNav(page, selector) {
  await page.evaluate(function (sel) {
    var el = document.querySelector(sel);
    var nav = document.querySelector('nav.tabs');
    var navTop = nav.getBoundingClientRect().top;
    var rect = el.getBoundingClientRect();
    if (rect.bottom > navTop - 12) window.scrollBy(0, rect.bottom - (navTop - 12));
    rect = el.getBoundingClientRect();
    if (rect.top < 8) window.scrollBy(0, rect.top - 8);
  }, selector);
}

async function shots(browser, url, htmlFile) {
  shotGuard.assertDemoHtml(htmlFile);
  var bag = { errors: [], external: [] };
  var opened = await openPage(browser, 390, 844);
  var page = opened.page;
  await watch(page, bag);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(function () { window.__duoSetTheme('light'); });
  await settle(page);
  await page.waitForSelector('[data-test="spent-over-line"]');
  fs.mkdirSync(SHOTS, { recursive: true });
  shotGuard.assertDemoHtml(htmlFile);

  await pinAboveNav(page, '#spentCard');
  await settle(page);
  var home = await page.locator('#spentCard').boundingBox();
  var navTop = await page.locator('nav.tabs').evaluate(function (el) { return el.getBoundingClientRect().top; });
  assert(home.y >= 0 && home.y + home.height <= navTop + 1, 'home card sits above the nav ' + JSON.stringify(home) + ' nav ' + navTop);
  var homeAdd = await brandPaint(page, '#addSpend');
  assertBrand(homeAdd, 'light', 'home add spending');
  assert(homeAdd.top >= 0 && homeAdd.bottom <= navTop, 'home add spending is in view');
  await page.screenshot({ path: path.join(SHOTS, 'phone-home-spent.png') });
  await page.screenshot({ path: path.join(SHOTS, 'phone-home-add-spending.png') });

  await page.click('[data-test="add-spending"]');
  await page.waitForSelector('[data-test="sp-date-show"]');
  await settle(page);
  var sheet = await page.locator('#sheet').evaluate(function (el) {
    var s = getComputedStyle(el);
    var save = document.querySelector('[data-test="sp-save"]').getBoundingClientRect();
    return { op: s.opacity, bg: s.backgroundColor, saveTop: save.top, saveBottom: save.bottom, vh: window.innerHeight, date: document.querySelector('[data-test="sp-date-show"]').textContent, iso: document.querySelector('[data-test="sp-date"]').value };
  });
  var parts = sheet.iso.split('-');
  assert(sheet.op === '1', 'sheet opacity ' + sheet.op);
  assert(sheet.bg.indexOf('rgba') !== 0 || /, ?1\)$/.test(sheet.bg), 'sheet background ' + sheet.bg);
  assert(sheet.date.indexOf(parts[2] + '/' + parts[1] + '/' + parts[0]) >= 0, 'shot date en-AU ' + sheet.date);
  assert(sheet.saveTop >= 0 && sheet.saveBottom <= sheet.vh + 1, 'save button in the viewport ' + JSON.stringify(sheet));
  await page.screenshot({ path: path.join(SHOTS, 'phone-add-spending.png') });

  await page.click('[data-test="sheet-close"]');
  await page.click('[data-test="spent-total"]');
  await page.waitForSelector('[data-test="spend-refund"]');
  await frameBrandButtons(page);
  await settle(page);
  var lightPill = await brandPaint(page, '#spentScope button.on');
  var lightAdd = await brandPaint(page, '#spentAdd');
  assertBrand(lightPill, 'light', 'spending scope pill');
  assertBrand(lightAdd, 'light', 'spending add button');
  var lightNav = await page.locator('nav.tabs').evaluate(function (el) { return el.getBoundingClientRect().top; });
  assert(lightPill.top >= 0 && lightPill.bottom <= lightNav && lightAdd.top >= 0 && lightAdd.bottom <= lightNav, 'light spending shows the pill and Add spending');
  await page.screenshot({ path: path.join(SHOTS, 'phone-spending-light.png') });
  await frameSpendingList(page);
  await settle(page);
  var listCheck = await page.evaluate(function () {
    function box(sel) { var r = document.querySelector(sel).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, left: r.left, right: r.right }; }
    var navTop = document.querySelector('nav.tabs').getBoundingClientRect().top;
    var back = box('#spentBack');
    var prev = box('#spentPrev');
    var next = box('#spentNext');
    var title = box('#spentTitle');
    var when = box('#spentWhen');
    var pill = box('#spentNav');
    var refund = box('[data-test="spend-refund"]');
    var tone = getComputedStyle(document.querySelector('[data-test="spend-refund"]')).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    var sec = document.querySelector('#v-spent').getBoundingClientRect();
    return {
      op: getComputedStyle(document.querySelector('#v-spent')).opacity,
      xbtns: document.querySelectorAll('#v-spent .xbtn').length,
      prevLabel: document.querySelector('#spentPrev').getAttribute('aria-label'),
      nextLabel: document.querySelector('#spentNext').getAttribute('aria-label'),
      back: back, prev: prev, next: next, title: title, when: when, pill: pill, refund: refund, navTop: navTop,
      text: document.querySelector('[data-test="spend-refund"]').innerText,
      g: tone ? +tone[2] : 0, r: tone ? +tone[1] : 0,
      secMid: (sec.left + sec.right) / 2, pillMid: (pill.left + pill.right) / 2
    };
  });
  assert(listCheck.op === '1', 'spending list opacity ' + listCheck.op);
  assert(listCheck.xbtns === 1, 'one back button on spending, got ' + listCheck.xbtns);
  assert(listCheck.prevLabel === 'Previous pay cycle' && listCheck.nextLabel === 'Next pay cycle', 'cycle aria labels');
  assert(listCheck.prev.h < listCheck.back.h - 4, 'cycle chevrons are smaller than the back button');
  assert(listCheck.back.top < listCheck.title.bottom && listCheck.prev.top >= listCheck.title.bottom - 4, 'period switcher sits below the title');
  assert(listCheck.prev.right <= listCheck.when.left + 2 && listCheck.next.left >= listCheck.when.right - 2, 'chevrons flank the period');
  assert(Math.abs(listCheck.pillMid - listCheck.secMid) < 28, 'period row is centred');
  assert(listCheck.title.top >= 0 && listCheck.refund.bottom <= listCheck.navTop, 'header and refund row are in view');
  assert(listCheck.text.indexOf('+$') >= 0 && listCheck.text.indexOf('Refund') >= 0 && listCheck.text.indexOf('-') < 0, 'demo refund text ' + listCheck.text);
  assert(listCheck.g > listCheck.r, 'demo refund is not rose');
  await page.screenshot({ path: path.join(SHOTS, 'phone-spending-list.png') });

  await page.click('[data-test="spent-back"]');
  await page.click('nav.tabs button[data-v="budget"]');
  await page.waitForSelector('#groups .group[data-cat="expenses"] .ghead');
  var over = await page.locator('#groups .group[data-cat="expenses"] [data-test="line-spent"].over').first().innerText();
  assert(over.indexOf('Running over by') >= 0, 'budget running over: ' + over);
  await page.evaluate(function () {
    var head = document.querySelector('#groups .group[data-cat="expenses"] .ghead');
    var strip = document.querySelector('#v-budget .summary-strip');
    var stripH = strip ? strip.getBoundingClientRect().height : 0;
    var top = head.getBoundingClientRect().top + window.scrollY - stripH - 8;
    window.scrollTo(0, Math.max(0, top));
  });
  await settle(page);
  var budgetFrame = await page.evaluate(function () {
    function box(sel) { var r = document.querySelector(sel).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }
    var navTop = document.querySelector('nav.tabs').getBoundingClientRect().top;
    var head = box('#groups .group[data-cat="expenses"] .ghead');
    var line = box('#groups .group[data-cat="expenses"] [data-test="line-spent"].over');
    return { navTop: navTop, head: head, line: line, vh: window.innerHeight };
  });
  assert(budgetFrame.head.top >= 0 && budgetFrame.head.bottom < budgetFrame.navTop, 'expenses header in the viewport');
  assert(budgetFrame.line.top >= 0 && budgetFrame.line.bottom < budgetFrame.navTop, 'running over line in the viewport');
  await page.screenshot({ path: path.join(SHOTS, 'phone-budget-over.png') });

  await page.setViewportSize({ width: 1376, height: 1032 });
  await page.click('nav.tabs button[data-v="dash"]');
  await page.evaluate(function () { window.scrollTo(0, 0); });
  await settle(page);
  var ipadCard = await page.locator('#spentCard').boundingBox();
  assert(ipadCard && ipadCard.y >= 0 && ipadCard.y + ipadCard.height <= 1032, 'iPad home shows the spent card ' + JSON.stringify(ipadCard));
  var ipadOp = await page.locator('#v-dash').evaluate(function (el) { return getComputedStyle(el).opacity; });
  assert(ipadOp === '1', 'iPad home opacity ' + ipadOp);
  await page.screenshot({ path: path.join(SHOTS, 'ipad-home.png') });
  await page.click('[data-test="spent-total"]');
  await page.waitForSelector('[data-test="spend-refund"]');
  await frameSpendingList(page);
  await settle(page);
  var ipadStack = await page.evaluate(function () {
    function box(sel) { var r = document.querySelector(sel).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, bottom: r.bottom, h: r.height }; }
    var sec = document.querySelector('#v-spent').getBoundingClientRect();
    var pill = document.querySelector('#spentNav').getBoundingClientRect();
    var tone = getComputedStyle(document.querySelector('[data-test="spend-refund"]')).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return {
      op: getComputedStyle(document.querySelector('#v-spent')).opacity,
      head: box('.sp-head'), scope: box('#spentScope'), list: box('#spendList'),
      refund: box('[data-test="spend-refund"]'), back: box('#spentBack'), prev: box('#spentPrev'),
      xbtns: document.querySelectorAll('#v-spent .xbtn').length,
      pillMid: (pill.left + pill.right) / 2, secMid: (sec.left + sec.right) / 2,
      g: tone ? +tone[2] : 0, r: tone ? +tone[1] : 0, vh: window.innerHeight
    };
  });
  assert(ipadStack.op === '1', 'iPad spending opacity');
  assert(ipadStack.head.y < ipadStack.scope.y && ipadStack.scope.y < ipadStack.list.y, 'iPad spending order');
  assert(Math.abs(ipadStack.list.x - ipadStack.head.x) < 24, 'iPad list is not floated to the side');
  assert(ipadStack.xbtns === 1 && ipadStack.prev.h < ipadStack.back.h - 4, 'iPad has one back button and smaller cycle chevrons');
  assert(Math.abs(ipadStack.pillMid - ipadStack.secMid) < 28, 'iPad period row is centred');
  assert(ipadStack.head.y >= 0 && ipadStack.refund.bottom <= ipadStack.vh, 'iPad header and refund are in view');
  assert(ipadStack.g > ipadStack.r, 'iPad refund is not rose');
  var ipadPill = await brandPaint(page, '#spentScope button.on');
  var ipadAdd = await brandPaint(page, '#spentAdd');
  assertBrand(ipadPill, 'light', 'iPad spending scope pill');
  assertBrand(ipadAdd, 'light', 'iPad spending add button');
  assert(ipadPill.top >= 0 && ipadPill.bottom <= ipadStack.vh && ipadAdd.top >= 0 && ipadAdd.bottom <= ipadStack.vh, 'iPad spending shows the pill and Add spending');
  await page.screenshot({ path: path.join(SHOTS, 'ipad-spending.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(function () { window.__duoSetTheme('dark'); });
  await frameBrandButtons(page);
  await settle(page);
  var darkPill = await brandPaint(page, '#spentScope button.on');
  var darkAdd = await brandPaint(page, '#spentAdd');
  assertBrand(darkPill, 'dark', 'spending scope pill');
  assertBrand(darkAdd, 'dark', 'spending add button');
  var darkNav = await page.locator('nav.tabs').evaluate(function (el) { return el.getBoundingClientRect().top; });
  assert(darkPill.top >= 0 && darkPill.bottom <= darkNav && darkAdd.top >= 0 && darkAdd.bottom <= darkNav, 'dark spending shows the pill and Add spending');
  await page.screenshot({ path: path.join(SHOTS, 'phone-spending-dark.png') });
  await frameSpendingList(page);
  await settle(page);
  var dark = await page.evaluate(function () {
    var tone = getComputedStyle(document.querySelector('[data-test="spend-refund"]')).color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    var navTop = document.querySelector('nav.tabs').getBoundingClientRect().top;
    var head = document.querySelector('.sp-head').getBoundingClientRect();
    var refund = document.querySelector('[data-test="spend-refund"]').getBoundingClientRect();
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      op: getComputedStyle(document.querySelector('#v-spent')).opacity,
      g: tone ? +tone[2] : 0, r: tone ? +tone[1] : 0,
      headTop: head.top, refundBottom: refund.bottom, navTop: navTop,
      text: document.querySelector('[data-test="spend-refund"]').innerText
    };
  });
  assert(dark.theme === 'dark' && dark.op === '1', 'dark spending list ' + JSON.stringify(dark));
  assert(dark.g > dark.r && dark.text.indexOf('+$') >= 0 && dark.text.indexOf('-') < 0, 'dark refund is positive teal ' + JSON.stringify(dark));
  assert(dark.headTop >= 0 && dark.refundBottom <= dark.navTop, 'dark header and refund are in view');
  await page.screenshot({ path: path.join(SHOTS, 'phone-spending-list-dark.png') });

  ['phone-home-spent.png', 'phone-home-add-spending.png', 'phone-add-spending.png', 'phone-spending-list.png', 'phone-spending-light.png', 'phone-budget-over.png', 'phone-spending-list-dark.png', 'phone-spending-dark.png'].forEach(function (name) {
    var sz = pngSize(path.join(SHOTS, name));
    assert(sz.w === 390 && sz.h === 844, name + ' viewport ' + sz.w + 'x' + sz.h);
  });
  ['ipad-home.png', 'ipad-spending.png'].forEach(function (name) {
    var sz = pngSize(path.join(SHOTS, name));
    assert(sz.w === 1376 && sz.h === 1032, name + ' viewport ' + sz.w + 'x' + sz.h);
  });
  assert(bag.errors.length === 0, 'demo-data console errors: ' + bag.errors.join(' | '));
  await opened.context.close();
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
