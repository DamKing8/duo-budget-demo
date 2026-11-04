#!/usr/bin/env node
'use strict';
var Lock = require('../../duo-lock.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assert(Lock.ITERATIONS >= 210000, 'the passcode hash uses at least 210,000 PBKDF2 rounds');
  assert(!Lock.validPin('123') && !Lock.validPin('12a4') && Lock.validPin('1234'), 'the passcode is 4 digits');
  var secret = await Lock.seal('1234', 1000);
  assert(secret.salt && secret.hash && secret.hash !== '1234' && secret.salt !== '1234', 'the stored record is a salt and a hash');
  assert(await Lock.verify('1234', secret), 'the right passcode matches');
  assert(!(await Lock.verify('9999', secret)), 'a wrong passcode does not match');
  var flipped = secret.hash.slice(0, -1) + (secret.hash.slice(-1) === 'A' ? 'B' : 'A');
  assert(!(await Lock.verify('1234', Object.assign({}, secret, { hash: flipped }))), 'a corrupted hash does not match');

  var now = 1_000_000;
  var s = Lock.freshSecret();
  s.hash = 'x';
  s.salt = 'eA==';
  var i;
  for (i = 0; i < 4; i++) Lock.recordFailure(s, now);
  assert(Lock.canTry(s, now).ok && s.lockedUntil === 0, 'the first four misses do not wait');
  Lock.recordFailure(s, now);
  var fifth = Lock.canTry(s, now);
  assert(!fifth.ok && fifth.reason === 'backoff' && s.lockedUntil === now + 30000, 'the fifth miss waits 30 seconds');
  assert(Lock.backoffMs(6) === 60000 && Lock.backoffMs(7) === 300000 && Lock.backoffMs(8) === 900000 && Lock.backoffMs(9) === 3600000, 'the waits step up to an hour');
  s.attempts = 9;
  Lock.recordFailure(s, now);
  var locked = Lock.canTry(s, now + 99999999);
  assert(!locked.ok && locked.reason === 'reauth', 'ten misses require signing in again');
  Lock.recordSuccess(s);
  assert(s.attempts === 0 && !s.forceReauth && Lock.canTry(Object.assign({ hash: 'x', salt: 'eA==' }, s), now).ok, 'a correct passcode clears the misses');

  var prefs = Lock.defaultPrefs();
  assert(!prefs.enabled && prefs.timeout === '1m' && prefs.hideInSwitcher, 'the lock is off, and a minute is the default once it is on');
  prefs.enabled = true;
  assert(Lock.shouldLock(prefs, { coldStart: true, now: now }), 'a cold start locks');
  assert(!Lock.shouldLock(prefs, { coldStart: false, backgroundAt: 0, now: now }), 'an open app does not lock itself');
  assert(!Lock.shouldLock(prefs, { coldStart: false, backgroundAt: now - 59000, now: now }), '59 seconds in the background stays open');
  assert(Lock.shouldLock(prefs, { coldStart: false, backgroundAt: now - 60000, now: now }), 'a minute in the background locks');
  prefs.timeout = 'immediate';
  assert(Lock.shouldLock(prefs, { coldStart: false, backgroundAt: now, now: now }), 'immediate locks as soon as the app returns');
  prefs.timeout = '5m';
  assert(!Lock.shouldLock(prefs, { coldStart: false, backgroundAt: now - 299000, now: now }), 'five minutes has not elapsed');
  assert(Lock.shouldLock(prefs, { coldStart: false, backgroundAt: now - 300000, now: now }), 'five minutes locks');
  prefs.enabled = false;
  assert(!Lock.shouldLock(prefs, { coldStart: true, now: now }), 'a lock that is off never locks');

  console.log('lock ok');
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
