#!/usr/bin/env node
'use strict';
var fs = require('fs');
var path = require('path');
var db = require('./with-db');

var HH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
var USER = '11111111-1111-4111-8111-111111111111';
var OTHER = '22222222-2222-4222-8222-222222222222';
var MEM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

db.withDb(async function (c) {
  await c.query(fs.readFileSync(path.join(__dirname, '../migrations/20261105_household_entitlements.sql'), 'utf8'));
  await c.query('insert into auth.users (id, email) values ($1, $2), ($3, $4)', [USER, 'chloe@example.com', OTHER, 'jack@example.com']);
  await c.query('insert into public.households (id, name) values ($1, $2)', [HH, 'Chloe & Jack']);
  await c.query(
    "insert into public.household_members (id, household_id, user_id, display_name, status) values ($1, $2, $3, 'Chloe', 'active')",
    [MEM, HH, USER]
  );
  await c.query(
    "insert into public.household_entitlements (household_id, status, payer_user_id, store, product_id, expires_at, trial_used) values ($1, 'active', $2, 'app_store', 'duo_premium_annual', now() + interval '30 days', true)",
    [HH, USER]
  );

  var seen = await db.asRole(c, USER, 'authenticated', function () {
    return c.query('select status, trial_used from public.household_entitlements');
  });
  assert(seen.rows.length === 1 && seen.rows[0].status === 'active' && seen.rows[0].trial_used === true, 'a member can read the household entitlement');

  var status = await db.asRole(c, USER, 'authenticated', function () {
    return c.query('select public.household_premium_status() as s');
  });
  assert(status.rows[0].s.status === 'active' && status.rows[0].s.trial_used === true, 'the paywall check reads the same row');

  var outsider = await db.asRole(c, OTHER, 'authenticated', function () {
    return c.query('select * from public.household_entitlements');
  });
  assert(outsider.rows.length === 0, 'someone outside the household cannot read it');

  var write = await db.fail(db.asRole(c, USER, 'authenticated', function () {
    return c.query("update public.household_entitlements set status = 'expired'");
  }));
  assert(write && write.message, 'a member cannot write the entitlement');

  await c.query("update public.household_members set status = 'left', left_at = now() where id = $1", [MEM]);
  var courtesy = await c.query('select status, courtesy_until, expires_at from public.household_entitlements where household_id = $1', [HH]);
  assert(courtesy.rows[0].status === 'grace' && courtesy.rows[0].courtesy_until, 'the household keeps 14 days when the payer leaves');
  var leftDays = (new Date(courtesy.rows[0].expires_at) - Date.now()) / 86400000;
  assert(leftDays > 13 && leftDays < 15, 'the courtesy window is about 14 days');

  console.log('premium sql ok');
}).catch(function (e) {
  console.error(e);
  process.exit(1);
});
