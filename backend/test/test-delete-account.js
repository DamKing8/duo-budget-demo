#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var withDb = require('./with-db').withDb;
var asRole = require('./with-db').asRole;
var openClient = require('./with-db').openClient;

var D = '11111111-1111-4111-8111-111111111111';
var N = '22222222-2222-4222-8222-222222222222';
var SOLO = '44444444-4444-4444-8444-444444444444';
var OTHER = '55555555-5555-4555-8555-555555555555';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await withDb(async function (c) {
    await c.query('insert into auth.users (id) values ($1),($2),($3)', [D, N, SOLO]);
    var hh = (await c.query("insert into households (name, created_by) values ('Home', $1) returning id", [D])).rows[0].id;
    var memD = (await c.query("insert into household_members (household_id, user_id, display_name, joined_at) values ($1,$2,'Chloe','2020-01-01') returning id", [hh, D])).rows[0].id;
    var memN = (await c.query("insert into household_members (household_id, user_id, display_name, joined_at) values ($1,$2,'Jack','2020-02-01') returning id", [hh, N])).rows[0].id;
    var personal = (await c.query("insert into budget_items (household_id, name, amount, freq, category, owner_member_id) values ($1,'Fun',40,'fortnight','personal',$2) returning id", [hh, memD])).rows[0].id;
    var shared = (await c.query("insert into budget_items (household_id, name, amount, freq, category) values ($1,'Groceries',460,'fortnight','expenses') returning id", [hh])).rows[0].id;
    var goal = (await c.query("insert into goals (household_id, name, target) values ($1,'Trip',1000) returning id", [hh])).rows[0].id;
    var personalSpend = (await c.query("insert into spend_entries (household_id, budget_item_id, line_name, category, owner_member_id, paid_by_member_id, amount, spent_on, note) values ($1,$2,'Fun','personal',$3,$3,42, current_date, 'books') returning id", [hh, personal, memD])).rows[0].id;
    var sharedSpend = (await c.query("insert into spend_entries (household_id, budget_item_id, line_name, category, paid_by_member_id, amount, spent_on, note) values ($1,$2,'Groceries','expenses',$3,80, current_date, 'coles') returning id", [hh, shared, memD])).rows[0].id;
    var partnerSpend = (await c.query("insert into spend_entries (household_id, category, owner_member_id, paid_by_member_id, amount, spent_on, note, line_name) values ($1,'personal',$2,$2,15, current_date, 'keep', 'Something else') returning id", [hh, memN])).rows[0].id;
    await c.query("insert into goal_contributions (household_id, goal_id, member_id, amount, note) values ($1,$2,$3,25,'secret')", [hh, goal, memD]);
    await c.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', D]);
    await c.query('update spend_entries set updated_at = now() where id = $1', [sharedSpend]);

    await asRole(c, D, 'authenticated', function () {
      return c.query('select public.delete_my_data()');
    });

    var ps = (await c.query('select amount, note, deleted_at from spend_entries where id = $1', [personalSpend])).rows[0];
    assert(ps.deleted_at && Number(ps.amount) === 0 && ps.note === '', 'personal spending is soft-deleted, zeroed and note blanked');
    var ss = (await c.query('select amount, note, paid_by_member_id, deleted_at from spend_entries where id = $1', [sharedSpend])).rows[0];
    assert(!ss.deleted_at && Number(ss.amount) === 80 && ss.note === '' && ss.paid_by_member_id === null, 'shared spending stays, payer and note are cleared');
    var ns = (await c.query('select amount, note, deleted_at from spend_entries where id = $1', [partnerSpend])).rows[0];
    assert(!ns.deleted_at && Number(ns.amount) === 15 && ns.note === 'keep', 'partner personal spending stays');
    var pb = (await c.query('select deleted_at from budget_items where id = $1', [personal])).rows[0];
    var sb = (await c.query('select deleted_at from budget_items where id = $1', [shared])).rows[0];
    assert(pb.deleted_at && !sb.deleted_at, 'personal line goes, shared line stays');
    var gc = (await c.query('select amount, note, member_id from goal_contributions where goal_id = $1', [goal])).rows[0];
    assert(Number(gc.amount) === 25 && gc.note === '' && gc.member_id === null, 'contribution amount stays, member and note are cleared');
    var scrubbed = ['spend_entries', 'budget_items', 'goals', 'pay_cycles', 'goal_contributions', 'household_members', 'households', 'invites'];
    for (var i = 0; i < scrubbed.length; i++) {
      var left = await c.query('select count(*)::int as n from ' + scrubbed[i] + ' where updated_by = $1', [D]);
      assert(left.rows[0].n === 0, 'updated_by scrubbed on ' + scrubbed[i]);
    }
    var mem = (await c.query('select status, left_at from household_members where id = $1', [memD])).rows[0];
    assert(mem.status === 'left' && mem.left_at, 'leaver is marked left');
    var house = (await c.query('select deleted_at from households where id = $1', [hh])).rows[0];
    assert(!house.deleted_at, 'shared household stays');
    var enabled = await c.query("select count(*)::int as n from pg_trigger where tgname = 'sync_row' and tgenabled = 'O' and not tgisinternal");
    assert(enabled.rows[0].n >= 8, 'sync triggers stay enabled');
    var fn = (await c.query("select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'delete_my_data'")).rows[0].prosrc;
    assert(!/disable\s+trigger/i.test(fn) && !/enable\s+trigger/i.test(fn) && !/alter\s+table/i.test(fn), 'delete_my_data does not alter triggers');
    assert(fn.indexOf("set_config('duo.skip_stamp', 'on', true)") >= 0, 'scrub is limited to this transaction');

    await c.query('insert into auth.users (id) values ($1)', [OTHER]);
    var otherHh = (await c.query("insert into households (name, created_by) values ('Other home', $1) returning id", [OTHER])).rows[0].id;
    var otherMem = (await c.query("insert into household_members (household_id, user_id, display_name) values ($1,$2,'Other') returning id", [otherHh, OTHER])).rows[0].id;
    await c.query("select set_config('request.jwt.claim.sub', '', false)");
    var otherSpend = (await c.query("insert into spend_entries (household_id, category, owner_member_id, amount, spent_on, note) values ($1,'personal',$2,7, current_date, 'other') returning id", [otherHh, otherMem])).rows[0].id;
    await c.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', D]);
    var mine = (await c.query("insert into spend_entries (household_id, category, amount, spent_on, note) values ($1,'expenses',4, current_date, 'mine') returning id, server_updated_at", [hh])).rows[0];
    await c.query('update spend_entries set note = $2, updated_at = now() where id = $1', [mine.id, 'stamped']);
    var mineBefore = (await c.query('select updated_by, server_updated_at, note from spend_entries where id = $1', [mine.id])).rows[0];
    assert(mineBefore.updated_by === D, 'caller row is stamped before the scrub');

    var dbname = (await c.query('select current_database() as n')).rows[0].n;
    var other = await openClient(dbname);
    try {
      await c.query('begin');
      await c.query("select set_config('duo.skip_stamp', 'on', true)");
      var hidden = await other.query("select current_setting('duo.skip_stamp', true) as v");
      assert(!hidden.rows[0].v, 'another session cannot see duo.skip_stamp');
      var stillOn = await other.query("select count(*)::int as n from pg_trigger where tgname = 'sync_row' and tgenabled = 'O' and not tgisinternal");
      assert(stillOn.rows[0].n >= 8, 'triggers stay enabled while this transaction skips the stamp');
      await c.query('update spend_entries set updated_by = null where id = $1 and updated_by = $2', [mine.id, D]);
      var scrub = (await c.query('select updated_by, server_updated_at, note from spend_entries where id = $1', [mine.id])).rows[0];
      assert(scrub.updated_by === null && scrub.note === 'stamped', 'clearing updated_by does not rewrite the row');
      assert(new Date(scrub.server_updated_at).getTime() === new Date(mineBefore.server_updated_at).getTime(), 'the scrub does not restamp server_updated_at');

      var otherBefore = (await other.query('select updated_by, server_updated_at from spend_entries where id = $1', [otherSpend])).rows[0];
      assert(otherBefore.updated_by === null, 'other household row is not stamped yet');
      await other.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', OTHER]);
      await other.query('set role authenticated');
      var stampedOther;
      try {
        stampedOther = await other.query('update spend_entries set amount = 8, updated_at = now() where id = $1 returning updated_by, updated_at, server_updated_at', [otherSpend]);
      } finally {
        await other.query('reset role');
      }
      assert(stampedOther.rowCount === 1, 'other household update ran');
      assert(stampedOther.rows[0].updated_by === OTHER, 'other household update sets updated_by');
      assert(stampedOther.rows[0].updated_at, 'other household update keeps updated_at');
      assert(new Date(stampedOther.rows[0].server_updated_at).getTime() >= new Date(otherBefore.server_updated_at).getTime(), 'other household update sets server_updated_at');

      await c.query('select pg_sleep(0.02)');
      var edited = (await c.query('update spend_entries set note = $2, updated_at = now(), updated_by = null where id = $1 returning updated_by, server_updated_at', [mine.id, 'changed'])).rows[0];
      assert(edited.updated_by === D, 'a real edit in the same transaction is still stamped');
      assert(new Date(edited.server_updated_at).getTime() > new Date(scrub.server_updated_at).getTime(), 'a real edit still bumps server_updated_at');
      await c.query("select set_config('duo.skip_stamp', 'off', true)");
      await c.query('commit');
    } catch (err) {
      try { await c.query('rollback'); } catch (e) { /* already closed */ }
      throw err;
    } finally {
      await other.end();
    }

    var soloHh = (await c.query("insert into households (name, created_by) values ('Solo', $1) returning id", [SOLO])).rows[0].id;
    var soloMem = (await c.query("insert into household_members (household_id, user_id, display_name) values ($1,$2,'Solo') returning id", [soloHh, SOLO])).rows[0].id;
    var soloSpend = (await c.query("insert into spend_entries (household_id, category, owner_member_id, amount, spent_on) values ($1,'expenses',$2,9, current_date) returning id", [soloHh, soloMem])).rows[0].id;
    await asRole(c, SOLO, 'authenticated', function () {
      return c.query('select public.delete_my_data()');
    });
    var gone = (await c.query('select deleted_at from households where id = $1', [soloHh])).rows[0];
    var goneSpend = (await c.query('select deleted_at from spend_entries where id = $1', [soloSpend])).rows[0];
    assert(gone.deleted_at && goneSpend.deleted_at, 'sole member soft-deletes the household and its spending');
    var mig = path.join(__dirname, '..', 'migrations');
    await c.query(fs.readFileSync(path.join(mig, '20261025_delete_my_data_scoped.sql'), 'utf8'));
    await c.query(fs.readFileSync(path.join(mig, '20261025_spend_entries_fk_indexes.sql'), 'utf8'));
    var again = (await c.query("select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'delete_my_data'")).rows[0].prosrc;
    assert(!/disable\s+trigger/i.test(again) && again.indexOf('duo.skip_stamp') >= 0, 'reapplying the migration keeps the scoped scrub');
    var indexes = await c.query("select indexname from pg_indexes where schemaname = 'public' and indexname in ('spend_entries_budget_item_fk_idx','spend_entries_owner_member_fk_idx','spend_entries_paid_by_member_fk_idx') order by 1");
    assert(indexes.rows.length === 3, 'foreign-key indexes exist');
    var priv = (await c.query("select has_function_privilege('authenticated', 'public.delete_my_data()', 'execute') as auth, has_function_privilege('anon', 'public.delete_my_data()', 'execute') as anon, has_function_privilege('service_role', 'public.delete_my_data()', 'execute') as svc")).rows[0];
    assert(priv.auth === true && priv.anon === false && priv.svc === false, 'execute stays authenticated-only');
    console.log('delete-account ok');
  });
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
