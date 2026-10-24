#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

if (Intl.DateTimeFormat().resolvedOptions().timeZone !== 'Australia/Sydney') {
  console.error('Run with TZ=Australia/Sydney');
  process.exit(1);
}

var html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function between(a, b) {
  var i = html.indexOf(a), j = html.indexOf(b);
  if (i < 0 || j < 0) throw new Error('missing ' + a);
  return html.slice(i + a.length, j);
}
function extractFn(name) {
  var start = html.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  var i = html.indexOf('{', start), depth = 0;
  for (var j = i; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') {
      depth--;
      if (depth === 0) return html.slice(start, j + 1);
    }
  }
  throw new Error('unclosed ' + name);
}

var src = ['var spendMemo=null;', 'var S={spends:[]};']
  .concat(['isoLocal', 'parseISO', 'dim', 'payAt', 'payIdx', 'payWindow'].map(extractFn))
  .concat([between('/*@@BUCKET_START@@*/', '/*@@BUCKET_END@@*/')])
  .join('\n');
var ctx = { console: console };
vm.createContext(ctx);
vm.runInContext(src, ctx);

var failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error('FAIL ' + msg); }
}

function iso(d) { return ctx.isoLocal(d); }

var pay = '2026-10-16';
var onPay = ctx.payWindow('fortnight', pay, ctx.parseISO('2026-10-16'));
var before = ctx.payWindow('fortnight', pay, ctx.parseISO('2026-10-15'));
assert(iso(onPay.start) === '2026-10-16' && iso(onPay.end) === '2026-10-30', 'payday opens the new window');
assert(iso(before.end) === '2026-10-16' && iso(before.start) === '2026-10-02', 'the day before stays in the previous window');
assert(ctx.entryInWindow('2026-10-16', onPay) && !ctx.entryInWindow('2026-10-16', before), 'an entry on payday counts in the new cycle');
assert(ctx.entryInWindow('2026-10-15', before) && !ctx.entryInWindow('2026-10-15', onPay), 'an entry the day before stays behind');

var anchor = '2026-01-31';
assert(iso(ctx.payAt(ctx.parseISO(anchor), 'month', 1)) === '2026-02-28', '31 Jan steps to 28 Feb');
assert(iso(ctx.payAt(ctx.parseISO(anchor), 'month', 2)) === '2026-03-31', 'the 31st returns in March');
var febPay = ctx.payWindow('month', anchor, ctx.parseISO('2026-02-28'));
var febBefore = ctx.payWindow('month', anchor, ctx.parseISO('2026-02-27'));
assert(iso(febPay.start) === '2026-02-28', 'month-end payday is inside the new window');
assert(iso(febBefore.start) === '2026-01-31', 'the day before a capped payday stays in January');

var spends = [{ on: '2026-10-20', amount: 10, owner: 'J', cat: 'expenses', itemId: 'g' }];
var w1 = ctx.payWindow('fortnight', '2026-10-16', ctx.parseISO('2026-10-20'));
var w2 = ctx.payWindow('fortnight', '2026-10-23', ctx.parseISO('2026-10-20'));
assert(iso(w1.start) === '2026-10-16' && ctx.spentIn(w1, null, spends).total === 10, 'entry sits in the original cycle');
assert(iso(w2.start) === '2026-10-09' && ctx.spentIn(w2, null, spends).total === 10, 'changing payday rebuckets the same entry');
assert(iso(w1.start) !== iso(w2.start), 'the two windows are different');

var instant = new Date('2026-03-31T13:30:00.000Z');
assert(iso(instant) === '2026-04-01', 'AEST midnight uses the local calendar day');
assert(instant.toISOString().slice(0, 10) === '2026-03-31', 'that instant is still the previous UTC date');
var localWin = ctx.payWindow('month', '2026-04-01', ctx.parseISO(iso(instant)));
var utcWin = ctx.payWindow('month', '2026-04-01', ctx.parseISO('2026-03-31'));
assert(iso(localWin.start) === '2026-04-01', 'local date lands in the April cycle');
assert(iso(utcWin.start) === '2026-03-01', 'the UTC date would have used March');

assert(ctx.parseSpendAmount('45') === 45, '45');
assert(ctx.parseSpendAmount('45.2') === 45.2, '45.2');
assert(ctx.parseSpendAmount('$1,200.50') === 1200.5, 'grouped dollars');
assert(ctx.parseSpendAmount('45.226') === 45.23, 'rounds to 2 decimals');
assert(ctx.parseSpendAmount('0') === null && ctx.parseSpendAmount('') === null && ctx.parseSpendAmount('-5') === null, 'rejects zero, blank and a typed minus');
assert(ctx.parseSpendAmount('100000.01') === null, 'rejects an amount over 100000');

var byLine = ctx.spentByLine(w1, [{ on: '2026-10-20', amount: 4, itemId: 'g' }, { on: '2026-10-20', amount: -1, itemId: 'g' }, { on: '2026-09-01', amount: 9, itemId: 'g' }]);
assert(byLine.g === 3, 'line total nets the refund and ignores another window');
var byOwner = ctx.spentByOwner(w1, [{ on: '2026-10-20', amount: 2, owner: 'D' }, { on: '2026-10-20', amount: 5, owner: 'J' }]);
assert(byOwner.D === 2 && byOwner.J === 5 && byOwner.N === 0, 'owner totals');

var state = { v: 3, names: { D: 'Chloe', N: 'Jack' }, items: [{ id: 'a', amount: 1 }], goals: [], note: 'keep' };
var beforeJson = JSON.stringify(state);
ctx.migrateV4(state);
var restored = JSON.parse(JSON.stringify(state));
restored.v = 3;
delete restored.spends;
assert(JSON.stringify(restored) === beforeJson, 'v3 to v4 leaves every other field byte-identical');
assert(state.v === 4 && Array.isArray(state.spends) && state.spends.length === 0, 'migration adds an empty spends list');
var again = { v: 4, spends: [{ id: 'x' }], items: [] };
ctx.migrateV4(again);
assert(again.spends.length === 1 && again.spends[0].id === 'x', 'an existing spends list is kept');

if (failed) {
  console.error(failed + ' bucketing assertion(s) failed');
  process.exit(1);
}
console.log('bucketing ok');
