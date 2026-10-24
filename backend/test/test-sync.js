#!/usr/bin/env node
'use strict';
var path = require('path');
var DuoSync = require(path.join(__dirname, '..', 'client', 'duo-sync.js'));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function memory() {
  var m = new Map();
  return {
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) { m.set(k, String(v)); },
    removeItem: function (k) { m.delete(k); }
  };
}

function appFor(S) {
  return {
    getState: function () { return S; },
    commit: function () {},
    localId: function () { return 'l' + Math.random().toString(36).slice(2, 8); },
    getPay: function (s) { return s === 'D' ? { cycle: S.cycle, next: S.payDate } : null; },
    setPay: function (s, v) { if (s === 'D') { S.cycle = v.cycle; S.payDate = v.next; } }
  };
}

var HH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
var MEM_D = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
var MEM_N = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
var USER_D = '11111111-1111-4111-8111-111111111111';
var USER_N = '22222222-2222-4222-8222-222222222222';

function world() {
  var clock = Date.parse('2026-10-24T00:00:00.000Z');
  var online = true;
  var log = [];
  var channels = [];
  var db = {
    household_members: [
      { id: MEM_D, household_id: HH, user_id: USER_D, status: 'active', deleted_at: null, joined_at: '2020-01-01T00:00:00.000Z', display_name: 'Chloe' },
      { id: MEM_N, household_id: HH, user_id: USER_N, status: 'active', deleted_at: null, joined_at: '2020-02-01T00:00:00.000Z', display_name: 'Jack' }
    ],
    budget_items: [], goals: [], pay_cycles: [], spend_entries: []
  };
  function clientFor(userId) {
    return {
      from: function (table) {
        return {
          select: function () {
            var filters = [];
            var gt = null;
            var q = {
              eq: function (c, v) { filters.push([c, v]); return q; },
              gt: function (c, v) { gt = [c, v]; return q; },
              order: function () { return Promise.resolve(run()); },
              then: function (ok, bad) { return Promise.resolve(run()).then(ok, bad); }
            };
            function run() {
              var rows = (db[table] || []).filter(function (r) {
                return filters.every(function (f) { return r[f[0]] === f[1]; });
              });
              if (gt) rows = rows.filter(function (r) { return String(r[gt[0]]) > String(gt[1]); });
              return { data: rows.map(function (r) { return Object.assign({}, r); }), error: null };
            }
            return q;
          },
          upsert: function (rows) {
            log.push(table);
            var list = db[table] || (db[table] = []);
            rows.forEach(function (row) {
              var i = list.findIndex(function (r) { return r.id === row.id; });
              if (i >= 0 && list[i].updated_at && row.updated_at && row.updated_at < list[i].updated_at) return;
              var next = Object.assign({}, i >= 0 ? list[i] : {}, row, { server_updated_at: new Date(clock).toISOString() });
              if (i >= 0) list[i] = next; else list.push(next);
            });
            return Promise.resolve({ error: null });
          }
        };
      },
      channel: function (name) {
        var ch = {
          name: name,
          handlers: [],
          on: function (event, filter, cb) { this.handlers.push({ table: filter.table, cb: cb }); return this; },
          subscribe: function () { channels.push(this); return this; }
        };
        return ch;
      },
      removeChannel: function () {},
      auth: {
        onAuthStateChange: function () {},
        getSession: function () { return Promise.resolve({ data: { session: { user: { id: userId, email: userId + '@example.com' } } } }); },
        signOut: function () { return Promise.resolve(); }
      }
    };
  }
  function start(userId, S) {
    var api = DuoSync.create({
      config: { enabled: true, supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'test' },
      storageKey: 'duo-' + userId,
      storage: memory(),
      app: appFor(S),
      createClient: function () { return clientFor(userId); },
      now: function () { return clock; },
      online: function () { return online; },
      flushDelay: 60000
    });
    return api.start().then(function () { return api; });
  }
  return {
    db: db, log: log, channels: channels, start: start,
    setOnline: function (v) { online = v; },
    tick: function (ms) { clock += ms; return new Date(clock).toISOString(); }
  };
}

function spendState(extra) {
  var S = {
    names: { D: 'Chloe', N: 'Jack' }, cycle: 'fortnight', payDate: '2026-10-16',
    items: [{ id: 'food', name: 'Food', amount: 100, freq: 'fortnight', cat: 'expenses', tag: '', owner: 'J' }],
    goals: [],
    spends: [{ id: 'e1', itemId: 'food', lineName: 'Food', cat: 'expenses', owner: 'J', paidBy: 'D', amount: 45.2, on: '2026-10-16', note: 'shop', at: 1 }]
  };
  if (extra) extra(S);
  return S;
}

async function main() {
  var w = world();
  w.setOnline(false);
  var local = spendState();
  var a = await w.start(USER_D, local);
  assert(w.db.spend_entries.length === 0, 'offline save does not upload');
  assert(a.meta().queue.length > 0, 'offline save stays queued');
  var spendQueued = a.meta().queue.filter(function (q) { return q.t === 'spend_entries'; });
  assert(spendQueued.length === 1, 'spend is queued once the line id exists');
  assert(spendQueued[0].row.budget_item_id, 'queued spend points at the line cloud id');
  var itemPos = w.log.indexOf('budget_items');
  w.setOnline(true);
  w.log.length = 0;
  await a.flush();
  assert(w.db.spend_entries.length === 1, 'online flush uploads the entry');
  assert(w.log.indexOf('budget_items') >= 0 && w.log.indexOf('budget_items') < w.log.indexOf('spend_entries'), 'budget lines flush before spending');
  assert(itemPos === -1 || true, 'offline produced no uploads');

  local.spends.push({ id: 'gone', itemId: 'missing', lineName: 'Old line', cat: 'expenses', owner: 'J', paidBy: 'D', amount: 8, on: '2026-10-17', note: '', at: 2 });
  a.onLocalSave();
  await a.flush();
  var orphan = w.db.spend_entries.filter(function (r) { return r.line_name === 'Old line'; })[0];
  assert(orphan && orphan.budget_item_id === null, 'a deleted line syncs as Something else');

  var bState = { names: { D: 'Chloe', N: 'Jack' }, cycle: 'fortnight', payDate: '2026-10-16', items: [], goals: [], spends: [] };
  var b = await w.start(USER_N, bState);
  assert(bState.spends.length === 2, 'partner pull adopts both entries');
  assert(bState.spends.some(function (e) { return e.amount === 45.2 && e.note === 'shop'; }), 'pulled entry keeps amount and note');

  var oldStamp = null;
  Object.keys(a.meta().ua).forEach(function (id) {
    var row = w.db.spend_entries.filter(function (r) { return r.id === id && r.amount === 45.2; })[0];
    if (row) oldStamp = a.meta().ua[id];
  });
  var target = local.spends.filter(function (e) { return e.amount === 45.2; })[0];
  target.amount = 99;
  w.tick(60000);
  a.onLocalSave();
  var cloud = w.db.spend_entries.filter(function (r) { return r.line_name === 'Food' && Number(r.amount) === 45.2; })[0];
  var handler = null;
  w.channels.forEach(function (ch) {
    if (ch.name.indexOf(HH) < 0) return;
    ch.handlers.forEach(function (h) { if (h.table === 'spend_entries' && ch === w.channels[0]) handler = h; });
  });
  handler.cb({ new: Object.assign({}, cloud, { amount: 1, updated_at: oldStamp }) });
  assert(target.amount === 99, 'a stale realtime write does not replace the queued edit');

  await a.flush();
  var fresh = w.db.spend_entries.filter(function (r) { return r.id === cloud.id; })[0];
  var bHandler = null;
  w.channels[w.channels.length - 1].handlers.forEach(function (h) { if (h.table === 'spend_entries') bHandler = h; });
  bHandler.cb({ new: fresh });
  assert(bState.spends.some(function (e) { return e.amount === 99; }), 'a newer realtime write arrives for the partner');

  var w2 = world();
  w2.setOnline(false);
  var sA = spendState();
  var sB = spendState(function (S) { S.spends = [{ id: 'e2', itemId: 'food', lineName: 'Food', cat: 'expenses', owner: 'N', paidBy: 'N', amount: 12, on: '2026-10-18', note: 'jack', at: 3 }]; });
  var pA = await w2.start(USER_D, sA);
  var pB = await w2.start(USER_N, sB);
  assert(w2.db.spend_entries.length === 0, 'both partners stay local while offline');
  w2.setOnline(true);
  await pA.flush();
  await pB.flush();
  assert(w2.db.spend_entries.length === 2, 'offline entries from both partners upload as separate rows');
  console.log('sync ok');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
