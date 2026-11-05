/* First-launch routing, storage keys, and provider visibility.
   No network. require()-able from tests. The page loads the same file. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DuoAccount = factory();
})(this, function () {
  'use strict';
  var LEGACY_KEY = 'duoBudget.demo.v1';
  var GATE_KEY = 'duoBudget.gate.v1';
  var WIDGET_KEY = 'duoBudget.widget';
  var BACKUP_PREFIX = 'duoBudget.backup.';
  var BACKUP_MS = 30 * 24 * 60 * 60 * 1000;
  var INACTIVE_MS = 30 * 24 * 60 * 60 * 1000;

  function budgetKey(uid) { return 'duoBudget.u.' + uid + '.v1'; }

  function emptyGate() {
    return { v: 1, guest: false, owner: null, welcomeDone: false, backupNudge: false, lockOffered: false, pendingGuest: false, inactiveSignOut: false, lastActive: 0 };
  }
  function readGate(store) {
    try {
      var g = JSON.parse(store.getItem(GATE_KEY) || 'null');
      if (g && g.v === 1) return g;
    } catch (e) {}
    return emptyGate();
  }
  function writeGate(store, g) {
    g.v = 1;
    store.setItem(GATE_KEY, JSON.stringify(g));
  }
  function readSessionUserId(store) {
    var i, k, raw, obj, user;
    try {
      for (i = 0; i < store.length; i++) {
        k = store.key(i);
        if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
        raw = store.getItem(k);
        if (!raw) continue;
        obj = JSON.parse(raw);
        user = obj && obj.user ? obj.user : (obj && obj.currentSession && obj.currentSession.user);
        if (!user && obj && obj.session) user = obj.session.user;
        if (user && user.id) return String(user.id);
      }
    } catch (e) {}
    return null;
  }
  function forgetSession(store) {
    var i, k, drop = [];
    try {
      for (i = 0; i < store.length; i++) {
        k = store.key(i);
        if (k && /^sb-.+-auth-token$/.test(k)) drop.push(k);
      }
    } catch (e) {}
    drop.forEach(function (key) { try { store.removeItem(key); } catch (e) {} });
  }
  function present(store, key) {
    try { return store.getItem(key) != null; } catch (e) { return false; }
  }
  function copyKey(store, from, to) {
    var raw = store.getItem(from);
    if (raw != null) store.setItem(to, raw);
    var sync = store.getItem(from + '.sync');
    if (sync != null) store.setItem(to + '.sync', sync);
  }
  function eachKey(store, fn) {
    var i, k, keys = [];
    try {
      for (i = 0; i < store.length; i++) {
        k = store.key(i);
        if (k) keys.push(k);
      }
    } catch (e) {}
    keys.forEach(fn);
  }
  function pruneBackups(store, now) {
    eachKey(store, function (k) {
      if (k.indexOf(BACKUP_PREFIX) !== 0) return;
      var v = null;
      try { v = JSON.parse(store.getItem(k) || 'null'); } catch (e) {}
      if (!v || !v.at || now - v.at > BACKUP_MS) { try { store.removeItem(k); } catch (e2) {} }
    });
  }
  function backupBudget(store, raw, now) {
    if (raw == null) return;
    now = now || Date.now();
    try { store.setItem(BACKUP_PREFIX + now, JSON.stringify({ at: now, raw: raw })); } catch (e) {}
    pruneBackups(store, now);
  }
  function wipeDevice(store, uid) {
    var drop = {};
    function add(k) { if (k) drop[k] = 1; }
    add(LEGACY_KEY);
    add(LEGACY_KEY + '.sync');
    add(WIDGET_KEY);
    if (uid) { add(budgetKey(uid)); add(budgetKey(uid) + '.sync'); }
    eachKey(store, function (k) {
      if (k.indexOf('duoBudget.u.') === 0 || k.indexOf(BACKUP_PREFIX) === 0) add(k);
    });
    Object.keys(drop).forEach(function (k) { try { store.removeItem(k); } catch (e) {} });
  }
  /* opts.legacyKey is the key this build already uses (personal builds differ).
     opts.skipWelcome is for the local preview and personal builds, which open
     straight into the sample budget. The shipped app does not set it. */
  function boot(store, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var legacy = opts.legacyKey || LEGACY_KEY;
    pruneBackups(store, now);
    var gate = readGate(store);
    var uid = readSessionUserId(store);
    if (opts.skipWelcome) {
      var skipKey = legacy;
      if (uid && present(store, budgetKey(uid))) skipKey = budgetKey(uid);
      return { screen: 'app', key: skipKey, uid: uid, holdDemo: false, nudge: false, localIsGuest: false, signedIn: !!uid, gate: gate, reason: '' };
    }
    if (uid && gate.lastActive && now - gate.lastActive > INACTIVE_MS && !gate.pendingGuest) {
      return { screen: 'welcome', key: legacy, uid: uid, holdDemo: true, nudge: false, localIsGuest: false, signedIn: false, gate: gate, reason: 'inactive', wipe: true };
    }
    if (uid) {
      var nk = budgetKey(uid);
      var named = present(store, nk);
      if (!named && present(store, legacy) && gate.owner !== 'guest' && !gate.pendingGuest) {
        copyKey(store, legacy, nk);
        gate.owner = uid;
        gate.welcomeDone = true;
        writeGate(store, gate);
        named = true;
      }
      var useLegacy = !!(gate.pendingGuest && present(store, legacy) && !named);
      return {
        screen: 'app',
        key: useLegacy ? legacy : nk,
        uid: uid,
        holdDemo: !useLegacy && !named,
        nudge: false,
        localIsGuest: useLegacy,
        signedIn: true,
        gate: gate,
        reason: ''
      };
    }
    if (gate.guest || present(store, legacy)) {
      if (!gate.guest && present(store, legacy)) {
        gate.guest = true;
        gate.owner = 'guest';
        gate.welcomeDone = true;
        writeGate(store, gate);
      }
      return { screen: 'app', key: legacy, uid: null, holdDemo: false, nudge: !gate.backupNudge && present(store, legacy), localIsGuest: true, signedIn: false, gate: gate, reason: '' };
    }
    return { screen: 'welcome', key: legacy, uid: null, holdDemo: true, nudge: false, localIsGuest: false, signedIn: false, gate: gate, reason: gate.inactiveSignOut ? 'inactive' : '' };
  }
  function applyInactive(store, plan, now) {
    if (!plan || !plan.wipe) return plan;
    forgetSession(store);
    wipeDevice(store, plan.uid);
    var g = readGate(store);
    g.guest = false;
    g.owner = null;
    g.pendingGuest = false;
    g.inactiveSignOut = true;
    g.welcomeDone = false;
    g.lastActive = 0;
    g.backupNudge = false;
    writeGate(store, g);
    plan.screen = 'welcome';
    plan.holdDemo = true;
    plan.key = plan.key || LEGACY_KEY;
    plan.uid = null;
    plan.signedIn = false;
    plan.localIsGuest = false;
    plan.reason = 'inactive';
    plan.gate = g;
    plan.wipe = false;
    if (now) g.lastActive = 0;
    return plan;
  }
  function visibleProviders(cfg, platform) {
    cfg = cfg || {};
    var apple = !!cfg.apple && (platform === 'ios' || !!cfg.appleClientId);
    var google = !!cfg.google;
    if (platform === 'ios' && google && !cfg.apple && !cfg.allowGoogleWithoutApple) google = false;
    return { apple: apple, google: google, email: true };
  }
  function nativeReady(cfg, provider, platform) {
    cfg = cfg || {};
    if (provider === 'apple') {
      if (!cfg.apple) return false;
      if (platform === 'ios') return true;
      return !!cfg.appleClientId;
    }
    if (provider === 'google') {
      if (!cfg.google) return false;
      if (platform === 'ios') return !!cfg.googleIosClientId;
      if (platform === 'android') return !!cfg.googleWebClientId;
    }
    return false;
  }
  function linkKind(info) {
    if (!info || !info.localHas) return null;
    return info.cloudHas ? 'choose-cloud' : 'keep-or-fresh';
  }
  function normaliseChoice(kind, choice) {
    if (kind === 'choose-cloud') return choice === 'replace-cloud' ? 'replace-cloud' : 'use-cloud';
    return choice === 'keep-local' ? 'keep-local' : 'fresh';
  }
  function passwordProblem(pw) {
    pw = String(pw || '');
    if (pw.length < 8) return 'Use at least 8 characters.';
    if (pw.length > 72) return 'Use 72 characters or fewer.';
    return '';
  }
  function touchActive(store, now) {
    var g = readGate(store);
    g.lastActive = now || Date.now();
    g.inactiveSignOut = false;
    writeGate(store, g);
    return g;
  }
  function markGuest(store) {
    var g = readGate(store);
    g.guest = true;
    g.owner = 'guest';
    g.welcomeDone = true;
    g.pendingGuest = false;
    writeGate(store, g);
    return g;
  }
  function markPendingGuest(store) {
    var g = readGate(store);
    g.pendingGuest = true;
    g.owner = 'guest';
    g.guest = true;
    writeGate(store, g);
    return g;
  }
  function claimOwner(store, uid) {
    var g = readGate(store);
    g.owner = uid;
    g.pendingGuest = false;
    g.guest = false;
    g.welcomeDone = true;
    writeGate(store, g);
    return g;
  }
  return {
    LEGACY_KEY: LEGACY_KEY, GATE_KEY: GATE_KEY, WIDGET_KEY: WIDGET_KEY, BACKUP_PREFIX: BACKUP_PREFIX, BACKUP_MS: BACKUP_MS, INACTIVE_MS: INACTIVE_MS,
    budgetKey: budgetKey, readGate: readGate, writeGate: writeGate, readSessionUserId: readSessionUserId,
    forgetSession: forgetSession, boot: boot, applyInactive: applyInactive, visibleProviders: visibleProviders,
    nativeReady: nativeReady, linkKind: linkKind, normaliseChoice: normaliseChoice, passwordProblem: passwordProblem,
    wipeDevice: wipeDevice, backupBudget: backupBudget, pruneBackups: pruneBackups, copyKey: copyKey,
    touchActive: touchActive, markGuest: markGuest, markPendingGuest: markPendingGuest, claimOwner: claimOwner
  };
});
