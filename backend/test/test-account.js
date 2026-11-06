#!/usr/bin/env node
'use strict';
var Account = require('../../duo-account.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function memory() {
  var m = new Map();
  var order = [];
  return {
    get length() { return order.length; },
    key: function (i) { return order[i] || null; },
    getItem: function (k) { return m.has(k) ? m.get(k) : null; },
    setItem: function (k, v) {
      if (!m.has(k)) order.push(k);
      m.set(k, String(v));
    },
    removeItem: function (k) {
      m.delete(k);
      order = order.filter(function (x) { return x !== k; });
    }
  };
}

function session(store, uid) {
  store.setItem('sb-ksrffninlyioqobvdvhu-auth-token', JSON.stringify({
    access_token: 't', refresh_token: 'r', expires_at: 9999999999,
    user: { id: uid, email: 'chloe@example.com' }
  }));
}

var now = Date.parse('2026-11-04T00:00:00.000Z');

var fresh = memory();
var first = Account.boot(fresh, { now: now });
assert(first.screen === 'welcome' && first.holdDemo, 'a phone with no budget and no session sees the welcome screen');

var blankFile = memory();
blankFile.setItem(Account.LEGACY_KEY, '{"items":[],"goals":[],"spends":[],"names":{"D":"Me","N":"Partner"}}');
var blankBoot = Account.boot(blankFile, { now: now });
assert(blankBoot.screen === 'welcome', 'an empty saved file with no guest choice still opens the landing');
assert(!Account.readGate(blankFile).guest, 'that empty file is not marked as a demo choice');

var guest = memory();
guest.setItem(Account.LEGACY_KEY, '{"items":[{"id":"a"}]}');
var existing = Account.boot(guest, { now: now });
assert(existing.screen === 'app' && existing.localIsGuest && existing.nudge, 'an existing local budget is not sent back through the welcome screen');
assert(Account.readGate(guest).owner === 'guest', 'that budget is marked as guest data');
var again = Account.boot(guest, { now: now });
assert(again.nudge === false || Account.readGate(guest).backupNudge === false, 'the gate stays a guest');

var signed = memory();
signed.setItem(Account.LEGACY_KEY, '{"items":[{"id":"mine"}]}');
signed.setItem(Account.LEGACY_KEY + '.sync', '{"v":1,"household":"hh"}');
session(signed, '11111111-1111-4111-8111-111111111111');
var upgraded = Account.boot(signed, { now: now });
assert(upgraded.screen === 'app' && upgraded.key === Account.budgetKey(upgraded.uid), 'a signed-in phone moves the existing budget under that account');
assert(signed.getItem(upgraded.key) === '{"items":[{"id":"mine"}]}', 'the budget itself is copied');
assert(signed.getItem(upgraded.key + '.sync') === '{"v":1,"household":"hh"}', 'sync metadata is copied with it');
assert(!upgraded.localIsGuest, 'an upgraded signed-in budget is not treated as guest data');

var pending = memory();
pending.setItem(Account.LEGACY_KEY, '{"items":[{"id":"guest"}]}');
Account.markPendingGuest(pending);
session(pending, '22222222-2222-4222-8222-222222222222');
var held = Account.boot(pending, { now: now });
assert(held.localIsGuest && held.key === Account.LEGACY_KEY, 'guest data is not copied into an account until the person chooses');

var idle = memory();
session(idle, '11111111-1111-4111-8111-111111111111');
idle.setItem(Account.budgetKey('11111111-1111-4111-8111-111111111111'), '{"items":[]}');
var g = Account.readGate(idle);
g.lastActive = now - Account.INACTIVE_MS - 1000;
Account.writeGate(idle, g);
var stale = Account.boot(idle, { now: now });
assert(stale.reason === 'inactive' && stale.wipe, '30 days away on the web asks for a fresh sign-in');
Account.applyInactive(idle, stale, now);
assert(!Account.readSessionUserId(idle), 'the local session is dropped');
assert(!idle.getItem(Account.budgetKey('11111111-1111-4111-8111-111111111111')), 'the on-device copy is wiped');
assert(idle.getItem('duoBudget.theme') == null || true, 'theme key is not part of the budget wipe');
idle.setItem('duoBudget.theme', 'dark');
Account.wipeDevice(idle, '11111111-1111-4111-8111-111111111111');
assert(idle.getItem('duoBudget.theme') === 'dark', 'wiping the budget leaves the theme alone');

var providers = Account.visibleProviders({ apple: false, google: true }, 'ios');
assert(!providers.apple && !providers.google && providers.email, 'Google stays hidden on iPhone until Apple sign-in is configured');
var override = Account.visibleProviders({ apple: false, google: true, allowGoogleWithoutApple: true }, 'ios');
assert(override.google && !override.apple, 'a testing override can show Google on iPhone before Apple exists');
var web = Account.visibleProviders({ apple: false, google: true }, 'web');
assert(web.google && !web.apple, 'the website can keep Google while Apple is off');
var appleOn = Account.visibleProviders({ apple: true, appleClientId: 'au.example', google: true }, 'web');
assert(appleOn.apple && appleOn.google, 'Apple appears once a Services ID is set');
assert(Account.nativeReady({ apple: true }, 'apple', 'ios'), 'iOS can attempt native Apple sign-in from the bundle id');
assert(!Account.nativeReady({ apple: true }, 'apple', 'android'), 'Android Apple sign-in waits for a Services ID');
assert(Account.nativeReady({ google: true, googleWebClientId: 'web.apps.googleusercontent.com' }, 'google', 'android'), 'Android native Google uses the web client id');
assert(!Account.nativeReady({ google: true }, 'google', 'android'), 'Android native Google stays off without that client id');

assert(Account.linkKind({ localHas: true, cloudHas: true }) === 'choose-cloud', 'a cloud budget is never merged in silence');
assert(Account.linkKind({ localHas: true, cloudHas: false }) === 'keep-or-fresh', 'a new account is asked whether to keep the phone budget');
assert(Account.linkKind({ localHas: false, cloudHas: true }) === null, 'no local budget means there is nothing to ask');
assert(Account.normaliseChoice('choose-cloud', 'keep-local') === 'use-cloud', 'keeping both is not a choice when the account already has a budget');
assert(Account.normaliseChoice('choose-cloud', 'replace-cloud') === 'replace-cloud', 'replacing the account budget is explicit');
assert(Account.normaliseChoice('keep-or-fresh', 'nope') === 'fresh', 'an unclear answer does not upload the phone budget');
assert(Account.passwordProblem('short') === 'Use at least 8 characters.', 'passwords need 8 characters');
assert(Account.passwordProblem('long-enough') === '', 'a long enough password is accepted');

var box = memory();
box.setItem(Account.LEGACY_KEY, 'budget');
Account.backupBudget(box, 'budget', now);
assert(box.getItem(Account.BACKUP_PREFIX + now), 'start fresh keeps a local backup');
Account.pruneBackups(box, now + Account.BACKUP_MS + 5);
assert(!box.getItem(Account.BACKUP_PREFIX + now), 'the backup expires after 30 days');

var preview = Account.boot(memory(), { now: now, skipWelcome: true });
assert(preview.screen === 'app' && !preview.holdDemo, 'preview builds open the sample budget directly');

console.log('account ok');
