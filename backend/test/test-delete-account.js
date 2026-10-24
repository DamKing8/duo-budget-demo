#!/usr/bin/env node
'use strict';
var withDb = require('./with-db').withDb;
var asRole = require('./with-db').asRole;

var D = '11111111-1111-4111-8111-111111111111';
var N = '22222222-2222-4222-8222-222222222222';
var SOLO = '44444444-4444-4444-8444-444444444444';

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
    var stamped = await c.query('select count(*)::int as n from spend_entries where updated_by = $1', [D]);
    assert(stamped.rows[0].n === 0, 'updated_by scrubbed on spending');
    var mem = (await c.query('select status, left_at from household_members where id = $1', [memD])).rows[0];
    assert(mem.status === 'left' && mem.left_at, 'leaver is marked left');
    var house = (await c.query('select deleted_at from households where id = $1', [hh])).rows[0];
    assert(!house.deleted_at, 'shared household stays');
    var enabled = await c.query("select count(*)::int as n from pg_trigger where tgname = 'sync_row' and tgenabled = 'O' and not tgisinternal");
    assert(enabled.rows[0].n >= 8, 'sync triggers are enabled again');

    var soloHh = (await c.query("insert into households (name, created_by) values ('Solo', $1) returning id", [SOLO])).rows[0].id;
    var soloMem = (await c.query("insert into household_members (household_id, user_id, display_name) values ($1,$2,'Solo') returning id", [soloHh, SOLO])).rows[0].id;
    var soloSpend = (await c.query("insert into spend_entries (household_id, category, owner_member_id, amount, spent_on) values ($1,'expenses',$2,9, current_date) returning id", [soloHh, soloMem])).rows[0].id;
    await asRole(c, SOLO, 'authenticated', function () {
      return c.query('select public.delete_my_data()');
    });
    var gone = (await c.query('select deleted_at from households where id = $1', [soloHh])).rows[0];
    var goneSpend = (await c.query('select deleted_at from spend_entries where id = $1', [soloSpend])).rows[0];
    assert(gone.deleted_at && goneSpend.deleted_at, 'sole member soft-deletes the household and its spending');
    console.log('delete-account ok');
  });
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
