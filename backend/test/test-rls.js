#!/usr/bin/env node
'use strict';
var withDb = require('./with-db').withDb;
var asRole = require('./with-db').asRole;
var fail = require('./with-db').fail;

var D = '11111111-1111-4111-8111-111111111111';
var N = '22222222-2222-4222-8222-222222222222';
var OUT = '33333333-3333-4333-8333-333333333333';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  await withDb(async function (c) {
    await c.query('insert into auth.users (id, email) values ($1,$2),($3,$4),($5,$6)', [D, 'd@example.com', N, 'n@example.com', OUT, 'out@example.com']);
    var hh = (await c.query("insert into households (name, created_by) values ('Home', $1) returning id", [D])).rows[0].id;
    var hh2 = (await c.query("insert into households (name, created_by) values ('Other', $1) returning id", [OUT])).rows[0].id;
    var memD = (await c.query("insert into household_members (household_id, user_id, display_name, joined_at) values ($1,$2,'Chloe','2020-01-01') returning id", [hh, D])).rows[0].id;
    var memN = (await c.query("insert into household_members (household_id, user_id, display_name, joined_at) values ($1,$2,'Jack','2020-02-01') returning id", [hh, N])).rows[0].id;
    var memOut = (await c.query("insert into household_members (household_id, user_id, display_name) values ($1,$2,'Outsider') returning id", [hh2, OUT])).rows[0].id;
    var item = (await c.query("insert into budget_items (household_id, name, amount, freq, category) values ($1,'Groceries',460,'fortnight','expenses') returning id", [hh])).rows[0].id;
    var otherItem = (await c.query("insert into budget_items (household_id, name, amount, freq, category) values ($1,'Theirs',10,'week','expenses') returning id", [hh2])).rows[0].id;
    var spend = (await c.query("insert into spend_entries (household_id, budget_item_id, line_name, category, amount, spent_on, note) values ($1,$2,'Groceries','expenses',20, current_date, 'seed') returning id", [hh, item])).rows[0].id;

    var seen = await asRole(c, D, 'authenticated', function () {
      return c.query('select id, amount from spend_entries where id = $1', [spend]);
    });
    assert(seen.rows.length === 1 && Number(seen.rows[0].amount) === 20, 'member can select');

    await asRole(c, D, 'authenticated', function () {
      return c.query("insert into spend_entries (household_id, budget_item_id, category, amount, spent_on, paid_by_member_id) values ($1,$2,'expenses',12.5, current_date, $3)", [hh, item, memD]);
    });
    await asRole(c, D, 'authenticated', function () {
      return c.query('update spend_entries set amount = 21, updated_at = now() where id = $1', [spend]);
    });
    var updated = await c.query('select amount from spend_entries where id = $1', [spend]);
    assert(Number(updated.rows[0].amount) === 21, 'member can update');

    var hidden = await asRole(c, OUT, 'authenticated', function () {
      return c.query('select id from spend_entries where household_id = $1', [hh]);
    });
    assert(hidden.rows.length === 0, 'non-member select is empty');

    var ins = await asRole(c, OUT, 'authenticated', function () {
      return fail(c.query("insert into spend_entries (household_id, category, amount, spent_on) values ($1,'expenses',5, current_date)", [hh]));
    });
    assert(/row-level security/i.test(ins.message), 'non-member insert rejected: ' + ins.message);

    var upd = await asRole(c, OUT, 'authenticated', function () {
      return c.query('update spend_entries set amount = 1, updated_at = now() where id = $1', [spend]);
    });
    assert(upd.rowCount === 0, 'non-member update changes nothing');

    var del = await asRole(c, D, 'authenticated', function () {
      return fail(c.query('delete from spend_entries where id = $1', [spend]));
    });
    assert(/permission denied/i.test(del.message), 'delete is not granted: ' + del.message);

    var anon = await asRole(c, null, 'anon', function () {
      return fail(c.query('select * from spend_entries'));
    });
    assert(/permission denied/i.test(anon.message), 'anon cannot select: ' + anon.message);

    var crossItem = await fail(c.query("insert into spend_entries (household_id, budget_item_id, category, amount, spent_on) values ($1,$2,'expenses',5, current_date)", [hh, otherItem]));
    assert(/foreign key|violates/i.test(crossItem.message), 'cross-household budget line rejected: ' + crossItem.message);

    var crossMember = await fail(c.query("insert into spend_entries (household_id, owner_member_id, category, amount, spent_on) values ($1,$2,'personal',5, current_date)", [hh, memOut]));
    assert(/foreign key|violates/i.test(crossMember.message), 'cross-household member rejected: ' + crossMember.message);

    var zero = await fail(c.query("insert into spend_entries (household_id, category, amount, spent_on) values ($1,'expenses',0, current_date)", [hh]));
    assert(/check|violates/i.test(zero.message), 'amount 0 rejected while live: ' + zero.message);

    await c.query("insert into spend_entries (household_id, category, amount, spent_on, deleted_at) values ($1,'expenses',0, current_date, now())", [hh]);

    var before = Number((await c.query('select amount from spend_entries where id = $1', [spend])).rows[0].amount);
    var stale = await c.query('update spend_entries set amount = 3, updated_at = now() - interval \'2 days\' where id = $1', [spend]);
    var after = Number((await c.query('select amount from spend_entries where id = $1', [spend])).rows[0].amount);
    assert(stale.rowCount === 0 || after === before, 'stale write is ignored');
    assert(after === before, 'amount unchanged after stale write');

    var grants = await c.query("select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='spend_entries' and grantee in ('anon','authenticated','service_role','PUBLIC') order by 1,2");
    var got = grants.rows.map(function (r) { return r.grantee + ' ' + r.privilege_type; }).join(', ');
    assert(got === 'authenticated INSERT, authenticated SELECT, authenticated UPDATE', 'grants: ' + got);
    console.log('rls ok' + (process.env.DUO_STUB_EXPOSED === '1' ? ' (stub exposed)' : ''));
  });
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
