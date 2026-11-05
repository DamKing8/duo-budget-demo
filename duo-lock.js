/* App-lock policy: passcode hash, attempt backoff, and when to lock.
   The hash lives in secure storage on a phone and in IndexedDB on the web.
   This file does not touch the DOM or a plugin. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DuoLock = factory();
})(this, function () {
  'use strict';
  var ITERATIONS = 210000;
  var TIMEOUTS = { immediate: 0, '1m': 60000, '5m': 300000 };

  function bytesToB64(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var s = atob(b64), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function randomSalt() {
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return b;
  }
  function hashPin(pin, salt, iterations) {
    var enc = new TextEncoder();
    var rounds = iterations || ITERATIONS;
    return crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt, iterations: rounds, hash: 'SHA-256' }, key, 256);
    }).then(function (bits) { return new Uint8Array(bits); });
  }
  function timingEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var d = 0, i;
    for (i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
  }
  function validPin(pin) { return /^\d{4}$/.test(String(pin || '')); }
  function backoffMs(attempts) {
    if (attempts < 5) return 0;
    if (attempts === 5) return 30000;
    if (attempts === 6) return 60000;
    if (attempts === 7) return 300000;
    if (attempts === 8) return 900000;
    return 3600000;
  }
  function freshSecret() {
    return { salt: '', hash: '', iterations: ITERATIONS, attempts: 0, lockedUntil: 0, forceReauth: false };
  }
  function recordFailure(secret, now) {
    secret.attempts = (secret.attempts || 0) + 1;
    var wait = backoffMs(secret.attempts);
    secret.lockedUntil = wait ? now + wait : 0;
    secret.forceReauth = secret.attempts >= 10;
    return secret;
  }
  function recordSuccess(secret) {
    secret.attempts = 0;
    secret.lockedUntil = 0;
    secret.forceReauth = false;
    return secret;
  }
  function canTry(secret, now) {
    if (!secret || !secret.hash) return { ok: false, reason: 'none' };
    if (secret.forceReauth || secret.attempts >= 10) return { ok: false, reason: 'reauth' };
    if (secret.lockedUntil && now < secret.lockedUntil) return { ok: false, reason: 'backoff', until: secret.lockedUntil };
    return { ok: true };
  }
  function shouldLock(prefs, ctx) {
    if (!prefs || !prefs.enabled) return false;
    if (ctx && ctx.coldStart) return true;
    if (!ctx || !ctx.backgroundAt) return false;
    var ms = TIMEOUTS[prefs.timeout];
    if (ms === undefined) ms = TIMEOUTS['1m'];
    return (ctx.now - ctx.backgroundAt) >= ms;
  }
  function defaultPrefs() {
    return { enabled: false, biometrics: false, timeout: '1m', hideInSwitcher: true, userId: '' };
  }
  function verify(pin, secret) {
    if (!validPin(pin) || !secret || !secret.hash || !secret.salt) return Promise.resolve(false);
    var salt = b64ToBytes(secret.salt);
    return hashPin(pin, salt, secret.iterations || ITERATIONS).then(function (got) {
      return timingEqual(got, b64ToBytes(secret.hash));
    });
  }
  function seal(pin, iterations) {
    if (!validPin(pin)) return Promise.reject(new Error('pin'));
    var salt = randomSalt();
    var rounds = iterations || ITERATIONS;
    return hashPin(pin, salt, rounds).then(function (hash) {
      return { salt: bytesToB64(salt), hash: bytesToB64(hash), iterations: rounds, attempts: 0, lockedUntil: 0, forceReauth: false };
    });
  }
  return {
    ITERATIONS: ITERATIONS, TIMEOUTS: TIMEOUTS, bytesToB64: bytesToB64, b64ToBytes: b64ToBytes,
    randomSalt: randomSalt, hashPin: hashPin, timingEqual: timingEqual, validPin: validPin,
    backoffMs: backoffMs, freshSecret: freshSecret, recordFailure: recordFailure, recordSuccess: recordSuccess,
    canTry: canTry, shouldLock: shouldLock, defaultPrefs: defaultPrefs, verify: verify, seal: seal
  };
});
