/* Welcome, guest choice, sign-out, password and app lock screens.
   Loaded beside index.html. Policy lives in duo-account.js and duo-lock.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DuoGate = factory();
})(this, function () {
  'use strict';
  var Account = typeof DuoAccount !== 'undefined' ? DuoAccount : null;
  var Lock = typeof DuoLock !== 'undefined' ? DuoLock : null;
  var PREFS_KEY = 'duoBudget.lock.prefs';
  var ctx = null;
  var plan = null;
  var prefs = null;
  var secret = null;
  var unlocked = false;
  var cold = true;
  var backgroundAt = 0;
  var lockOffered = false;
  var linkWait = null;
  var bioType = 0;
  var bioAvailable = false;
  var mode = '';
  var lockKind = '';
  var emailReturn = null;
  var LOCK_SLOGAN = 'Plan around both paydays.';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function storage() { return ctx && ctx.storage ? ctx.storage : localStorage; }
  function authCfg() {
    var c = (ctx && ctx.authConfig && ctx.authConfig()) || {};
    return c;
  }
  function platform() { return ctx && ctx.platform ? ctx.platform() : 'web'; }
  function sync() { return ctx && ctx.sync ? ctx.sync() : null; }
  function ready() {
    var p = (ctx && ctx.ready && ctx.ready()) || Promise.resolve();
    return Promise.resolve(p).then(function () { return sync(); });
  }
  function plugin(name) {
    try {
      var cap = window.Capacitor;
      if (cap && cap.Plugins && cap.Plugins[name]) return cap.Plugins[name];
    } catch (e) {}
    return null;
  }
  function readPrefs() {
    try {
      var p = JSON.parse(storage().getItem(PREFS_KEY) || 'null');
      if (p && typeof p === 'object') return Object.assign(Lock.defaultPrefs(), p);
    } catch (e) {}
    return Lock.defaultPrefs();
  }
  function writePrefs(p) {
    prefs = p;
    try { storage().setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) {}
    privacy(!!(p.enabled && p.hideInSwitcher));
  }
  function idb(mode, key, value) {
    return new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(mode === 'get' ? null : false); return; }
      var open = indexedDB.open('duoBudget', 1);
      open.onupgradeneeded = function () {
        if (!open.result.objectStoreNames.contains('secure')) open.result.createObjectStore('secure');
      };
      open.onerror = function () { resolve(mode === 'get' ? null : false); };
      open.onsuccess = function () {
        try {
          var db = open.result;
          var tx = db.transaction('secure', mode === 'get' ? 'readonly' : 'readwrite');
          var store = tx.objectStore('secure');
          var req = mode === 'get' ? store.get(key) : mode === 'del' ? store.delete(key) : store.put(value, key);
          req.onsuccess = function () { resolve(mode === 'get' ? (req.result || null) : true); };
          req.onerror = function () { resolve(mode === 'get' ? null : false); };
        } catch (e) { resolve(mode === 'get' ? null : false); }
      };
    });
  }
  var prefixSet = null;
  function secureApi() {
    var p = plugin('SecureStorage');
    if (!p) return null;
    if (!prefixSet && p.setKeyPrefix) prefixSet = p.setKeyPrefix('duo.');
    else if (!prefixSet) prefixSet = Promise.resolve();
    return p;
  }
  function secretGet() {
    var p = secureApi();
    if (p && p.getItem) {
      return prefixSet.then(function () { return p.getItem('lock'); }).then(function (raw) {
        if (!raw) return idb('get', 'lock').then(parseSecret);
        return parseSecret(raw);
      }).catch(function () { return idb('get', 'lock').then(parseSecret); });
    }
    return idb('get', 'lock').then(parseSecret);
  }
  function parseSecret(raw) {
    if (!raw) return null;
    if (typeof raw === 'string') { try { return JSON.parse(raw); } catch (e) { return null; } }
    return raw;
  }
  function secretSet(rec) {
    secret = rec;
    var raw = JSON.stringify(rec);
    var p = secureApi();
    var web = idb('set', 'lock', raw);
    if (p && p.setItem) return prefixSet.then(function () { return p.setItem('lock', raw); }).catch(function () {}).then(function () { return web; });
    return web;
  }
  function secretClear() {
    secret = null;
    var p = secureApi();
    var web = idb('del', 'lock');
    if (p && p.remove) return prefixSet.then(function () { return p.remove('lock'); }).catch(function () {}).then(function () { return web; });
    return web;
  }
  function privacy(on) {
    var el = document.documentElement;
    if (on) el.classList.add('duo-privacy');
    else if (!unlockedGate()) el.classList.remove('duo-privacy');
    var p = plugin('PrivacyScreen');
    if (!p) return;
    var call = on && p.enable ? p.enable({ ios: { blurEffect: 'light' }, android: { dimBackground: true, privacyModeOnActivityHidden: 'dim' } }) : (p.disable ? p.disable() : null);
    if (call && call.catch) call.catch(function () {});
  }
  function unlockedGate() {
    var g = $('duoGate');
    return !!(g && g.classList.contains('on') && mode.indexOf('lock') === 0);
  }
  function show(html, opts) {
    var g = $('duoGate');
    if (!g) return;
    g.innerHTML = '<div class="duo-gate-in">' + html + '</div>';
    g.classList.add('on');
    g.classList.toggle('lock-open', !!(opts && opts.lock));
    g.removeAttribute('hidden');
    document.documentElement.classList.add('duo-gated');
  }
  function hide() {
    var g = $('duoGate');
    if (!g) return;
    g.classList.remove('on');
    g.classList.remove('lock-open');
    g.setAttribute('hidden', '');
    g.innerHTML = '';
    document.documentElement.classList.remove('duo-gated');
    mode = '';
  }
  function logo() {
    return '<div class="logo mark duo-mark"><img src="icons/logo-mark.webp" width="168" height="168" alt=""></div>';
  }
  function providers() {
    return Account.visibleProviders(authCfg(), platform());
  }
  function bioName() {
    if (bioType === 2) return 'Face ID';
    if (bioType === 1) return 'Touch ID';
    if (bioType === 3) return 'fingerprint';
    if (bioType === 4) return 'face unlock';
    return 'biometrics';
  }
  function refreshBio() {
    var p = plugin('BiometricAuthNative');
    if (!p || !p.checkBiometry || platform() === 'web') {
      bioAvailable = false;
      bioType = 0;
      return Promise.resolve(false);
    }
    return p.checkBiometry().then(function (info) {
      bioAvailable = !!(info && info.isAvailable);
      bioType = info && info.biometryType || 0;
      if (bioAvailable && mode === 'lock' && lockKind === 'unlock' && !$('gate-bio')) showLock('unlock');
      return bioAvailable;
    }).catch(function () { bioAvailable = false; return false; });
  }
  function nativeSocial(provider) {
    var Social = plugin('SocialLogin');
    if (!Social || !Social.initialize || !Social.login) return Promise.reject(new Error('native-missing'));
    var cfg = authCfg();
    var init = {};
    if (provider === 'google') {
      init.google = { mode: 'online' };
      if (cfg.googleWebClientId) init.google.webClientId = cfg.googleWebClientId;
      if (cfg.googleIosClientId) init.google.iOSClientId = cfg.googleIosClientId;
    } else {
      init.apple = { clientId: cfg.appleClientId || '', redirectUrl: platform() === 'ios' ? '' : 'https://ksrffninlyioqobvdvhu.supabase.co/auth/v1/callback', useProperTokenExchange: false };
    }
    var bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    var raw = Array.prototype.map.call(bytes, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)).then(function (buf) {
      var hashed = Array.prototype.map.call(new Uint8Array(buf), function (x) { return (x + 256).toString(16).slice(1); }).join('');
      var nonce = provider === 'apple' ? hashed : raw;
      return Social.initialize(init).then(function () {
        return Social.login({ provider: provider, options: { scopes: provider === 'apple' ? ['name', 'email'] : ['profile', 'email'], nonce: nonce } });
      }).then(function (res) {
        var result = res && res.result || {};
        var token = result.idToken;
        if (!token) throw new Error('no-token');
        return sync().signInWithIdToken(provider, token, raw);
      });
    });
  }
  function startProvider(provider) {
    if (plan && plan.localIsGuest) Account.markPendingGuest(storage());
    ready().then(function (api) {
      if (!api) return;
      var cfg = authCfg();
      if (!Account.nativeReady(cfg, provider, platform())) { api.signIn(provider); return; }
      nativeSocial(provider).catch(function (err) {
        if (err && (err.code === 'USER_CANCELLED' || err.message === 'USER_CANCELLED')) return;
        api.signIn(provider);
      });
    });
  }
  function showWelcome() {
    mode = 'welcome';
    var note = plan && plan.reason === 'inactive' ? '<p class="sub">You\'ve been away from this browser for 30 days, so we signed you out. Your budget is safe.</p>' : '<p class="sub">Plan around both paydays.</p>';
    var appleMark = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.24 2.73 2.2 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.5zM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22z"/></svg>';
    var googleMark = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
    var buttons = '';
    buttons += '<button class="btn apple block" type="button" id="gate-apple" data-test="welcome-apple">' + appleMark + '<span>Sign in with Apple</span></button>';
    buttons += '<button class="btn google block" type="button" id="gate-google" data-test="welcome-google">' + googleMark + '<span>Sign in with Google</span></button>';
    buttons += '<button class="btn pri block" type="button" id="gate-email" data-test="welcome-email">Continue with email</button>';
    show('<div class="duo-welcome" data-test="welcome">' + logo() + '<h2 class="page">Duo Budget</h2>' + note +
      '<div class="duo-actions">' + buttons + '</div>' +
      '<button class="btn ghost block" type="button" id="gate-guest" data-test="welcome-guest">Try demo</button>' +
      '<p class="mock">Your budget stays on this phone. Add an account any time.</p>' +
      '<p class="mock"><a href="privacy.html">Privacy</a> · <a href="delete-account.html">Delete an account</a></p></div>');
    var apple = $('gate-apple'); if (apple) apple.addEventListener('click', function () { startProvider('apple'); });
    var google = $('gate-google'); if (google) google.addEventListener('click', function () { startProvider('google'); });
    $('gate-email').addEventListener('click', function () { showEmail(false); });
    $('gate-guest').addEventListener('click', continueGuest);
  }
  function showEmail(password) {
    mode = password ? 'password' : 'email';
    var back = '<button class="linkbtn" type="button" id="gate-back">Back</button>';
    if (password) {
      show('<div data-test="email-password-screen"><h2 class="page">Use a password</h2><p class="sub">Same account as your email code. You can set or reset a password in Partners after you sign in.</p>' +
        '<label class="fl" for="gate-email-input">Email</label><input class="field" id="gate-email-input" data-test="gate-email" type="email" autocomplete="username" inputmode="email">' +
        '<label class="fl" for="gate-password">Password</label><input class="field" id="gate-password" data-test="gate-password" type="password" autocomplete="current-password">' +
        '<div class="ferr" id="gate-err" data-test="gate-err"></div>' +
        '<button class="btn pri block" type="button" id="gate-password-go" data-test="gate-password-go">Sign in</button>' +
        '<button class="linkbtn" type="button" id="gate-forgot" data-test="gate-forgot">Forgot your password? Get a code by email</button>' + back + '</div>');
      $('gate-password-go').addEventListener('click', submitPassword);
      $('gate-forgot').addEventListener('click', function () { showEmail(false); });
    } else {
      show('<div data-test="email-screen"><h2 class="page">Continue with email</h2><p class="sub">We\'ll email you a 6-digit code. No password needed.</p>' +
        '<label class="fl" for="gate-email-input">Email</label><input class="field" id="gate-email-input" data-test="gate-email" type="email" autocomplete="username" inputmode="email" placeholder="you@example.com">' +
        '<div class="ferr" id="gate-err" data-test="gate-err"></div>' +
        '<button class="btn pri block" type="button" id="gate-send" data-test="email-send">Send code</button>' +
        '<button class="linkbtn" type="button" id="gate-use-password" data-test="gate-use-password">Use a password instead</button>' + back + '</div>');
      $('gate-send').addEventListener('click', sendCode);
      $('gate-use-password').addEventListener('click', function () { showEmail(true); });
    }
    $('gate-back').addEventListener('click', function () {
      if (emailReturn) { emailReturn = null; hide(); return; }
      showWelcome();
    });
  }
  function returnToSync() {
    if (ctx && ctx.openPartner) ctx.openPartner();
    setTimeout(function () {
      var card = document.getElementById('syncCard');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center' });
    }, 80);
  }
  function openEmailSignIn(opts) {
    opts = opts || {};
    emailReturn = typeof opts.after === 'function' ? opts.after : returnToSync;
    showEmail(false);
  }
  function sendCode() {
    var email = $('gate-email-input').value.trim();
    var err = $('gate-err');
    if (!ctx.validEmail(email)) { err.textContent = 'Check the email address and try again.'; return; }
    err.textContent = '';
    $('gate-send').disabled = true;
    ready().then(function (api) {
      return api.signInWithEmail(email).then(function (r) {
        $('gate-send').disabled = false;
        if (r && r.error) { err.textContent = (ctx.otpProblem ? ctx.otpProblem(r.error, 'send') : r.error.message); return; }
        showCode(email, 'email');
      });
    }).catch(function () { $('gate-send').disabled = false; err.textContent = 'We couldn\'t send the code. Check your connection and try again.'; });
  }
  function showCode(email, type) {
    mode = 'code';
    show('<div data-test="email-code-screen"><h2 class="page">Enter your code</h2><p class="sub">We\'ve sent a 6-digit code to <b>' + esc(email) + '</b>. Type it in below.</p>' +
      '<div class="otp-wrap"><div class="otp-cells" data-test="gate-cells">' + '<span></span>'.repeat(6) + '</div>' +
      '<input class="otp-catch" id="gate-code" data-test="gate-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" aria-label="6-digit code"></div>' +
      '<div class="ferr" id="gate-err"></div>' +
      '<button class="btn pri block" type="button" id="gate-verify" data-test="gate-verify">Sign in</button>' +
      '<button class="linkbtn" type="button" id="gate-back">Use a different email</button></div>');
    var input = $('gate-code');
    var cells = [].slice.call(document.querySelectorAll('#duoGate .otp-cells span'));
    function paint() {
      var v = String(input.value || '').replace(/\D/g, '').slice(0, 6);
      input.value = v;
      cells.forEach(function (c, i) { c.textContent = v[i] || ''; c.classList.toggle('fill', !!v[i]); });
    }
    function submit() {
      var code = input.value;
      if (code.length !== 6) { $('gate-err').textContent = 'Enter all 6 digits.'; return; }
      $('gate-verify').disabled = true;
      ready().then(function (api) {
        var call = type === 'recovery' ? api.verifyRecoveryCode(email, code) : api.verifyEmailCode(email, code);
        return call.then(function (r) {
          $('gate-verify').disabled = false;
          if (r && r.error) { $('gate-err').textContent = ctx.otpProblem ? ctx.otpProblem(r.error, 'verify') : r.error.message; return; }
          if (type === 'recovery') { hide(); openSetPassword(true); }
        });
      });
    }
    input.addEventListener('input', function () { $('gate-err').textContent = ''; paint(); if (input.value.length === 6) submit(); });
    $('gate-verify').addEventListener('click', submit);
    $('gate-back').addEventListener('click', function () { showEmail(false); });
    paint();
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 40);
  }
  function submitPassword() {
    var email = $('gate-email-input').value.trim();
    var password = $('gate-password').value;
    var err = $('gate-err');
    if (!ctx.validEmail(email)) { err.textContent = 'Check the email address and try again.'; return; }
    var problem = Account.passwordProblem(password);
    if (problem) { err.textContent = problem; return; }
    err.textContent = '';
    ready().then(function (api) {
      return api.signInWithPassword(email, password).then(function (r) {
        if (r && r.error) err.textContent = 'That email and password don\'t match. Try again, or get a code by email.';
      });
    });
  }
  function continueGuest() {
    if (ctx.setSampleOnly) ctx.setSampleOnly(false);
    if (ctx.useBlank) ctx.useBlank();
    Account.markGuest(storage());
    if (ctx.save) ctx.save();
    if (ctx.render) ctx.render();
    plan = Account.boot(storage(), { legacyKey: ctx.getKey(), now: Date.now(), skipWelcome: false });
    hide();
  }
  function askLink(info, resolve) {
    linkWait = resolve;
    var fresh = info.kind !== 'choose-cloud';
    var title = fresh ? 'Keep this budget?' : 'This account already has a budget';
    var body = fresh
      ? 'You\'ve got a budget on this phone. Add it to your account so it syncs to both phones?'
      : 'We won\'t merge them. Choose your account\'s budget, or replace it with the one on this phone.';
    var primary = fresh
      ? '<button class="btn pri block" type="button" id="gate-keep" data-test="keep-budget">Yes, keep it</button>'
      : '<button class="btn pri block" type="button" id="gate-cloud" data-test="use-cloud">Use the account budget</button>';
    var secondary = fresh
      ? '<button class="btn ghost block" type="button" id="gate-fresh" data-test="start-fresh">Start fresh</button><p class="mock">Start fresh keeps a copy on this phone for 30 days. It is not uploaded.</p>'
      : '<button class="btn ghost block" type="button" id="gate-replace" data-test="replace-cloud">Replace with this phone</button>';
    show('<div data-test="keep-screen"><h2 class="page">' + title + '</h2><p class="sub">' + body + '</p>' + primary + secondary + '</div>');
    function pick(choice) {
      if (choice === 'replace-cloud') {
        show('<div data-test="replace-confirm"><h2 class="page">Replace the account budget?</h2><p class="sub">The budget in your account is replaced with the one on this phone. Your partner will see that change. This does not delete your account.</p>' +
          '<button class="btn danger block" type="button" id="gate-replace-yes">Replace the account budget</button>' +
          '<button class="btn ghost block" type="button" id="gate-replace-no">Use the account budget</button></div>');
        $('gate-replace-yes').addEventListener('click', function () { finishLink('replace-cloud'); });
        $('gate-replace-no').addEventListener('click', function () { finishLink('use-cloud'); });
        return;
      }
      finishLink(choice);
    }
    function finishLink(choice) {
      var done = linkWait;
      linkWait = null;
      if (choice === 'fresh') {
        try { Account.backupBudget(storage(), storage().getItem(ctx.getKey()), Date.now()); } catch (e) {}
        var S = ctx.getState();
        S.items = []; S.goals = []; S.spends = [];
        if (ctx.save) ctx.save();
      }
      hide();
      if (done) done(choice);
    }
    var keep = $('gate-keep'); if (keep) keep.addEventListener('click', function () { pick('keep-local'); });
    var cloud = $('gate-cloud'); if (cloud) cloud.addEventListener('click', function () { pick('use-cloud'); });
    var fr = $('gate-fresh'); if (fr) fr.addEventListener('click', function () { pick('fresh'); });
    var rep = $('gate-replace'); if (rep) rep.addEventListener('click', function () { pick('replace-cloud'); });
  }
  function pad(targetId) {
    var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
    return '<div class="duo-pad" data-test="passcode-pad" id="' + targetId + '">' + keys.map(function (k) {
      if (!k) return '<span></span>';
      if (k === 'del') return '<button type="button" data-key="del" aria-label="Delete">⌫</button>';
      return '<button type="button" data-key="' + k + '">' + k + '</button>';
    }).join('') + '</div>';
  }
  function dots(n) {
    var i, h = '';
    for (i = 0; i < 4; i++) h += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return '<div class="duo-dots" data-test="passcode-dots">' + h + '</div>';
  }
  function showLock(kind) {
    mode = 'lock';
    kind = kind || 'unlock';
    lockKind = kind;
    secretGet().then(function (rec) {
      if (lockKind !== kind) return;
      secret = rec;
      if (kind === 'unlock' && (!secret || !secret.hash)) { showLock('create'); return; }
      var now = Date.now();
      var gate = Lock.canTry(secret || {}, now);
      var bioBtn = prefs.biometrics && bioAvailable && kind === 'unlock' && gate.ok
        ? '<button class="btn pri block" type="button" id="gate-bio" data-test="lock-bio">Unlock with ' + esc(bioName()) + '</button>' : '';
      var help = platform() === 'web' ? '<p class="mock">On the web, the passcode only hides your budget in this browser.</p>' : '';
      var err = '';
      if (kind === 'unlock' && gate.reason === 'reauth') err = '<p class="sub">Too many tries. Sign in again to set a new passcode. Your budget is safe.</p>';
      else if (kind === 'unlock' && gate.reason === 'backoff') err = '<p class="sub">Try again in ' + Math.ceil((gate.until - now) / 1000) + ' seconds.</p>';
      var title = kind === 'create' ? 'Choose a 4-digit passcode' : kind === 'confirm' ? 'Enter it once more to confirm' : 'Duo Budget is locked';
      var forgot = kind === 'unlock' ? '<button class="linkbtn" type="button" id="gate-forgot-pass" data-test="forgot-passcode">Forgot passcode?</button>' : '';
      var padHtml = (gate.ok || kind !== 'unlock') ? pad('gate-pad') : '';
      var build = window.DUO_BUILD || {};
      var stamp = '<p class="build-stamp" data-test="lock-build">Build ' + esc(build.sha || 'dev') + (build.time ? ' · ' + esc(build.time) : '') + '</p>';
      if (kind === 'unlock') {
        show('<div class="lock-invite" data-test="lock-screen">' +
          '<div class="lock-mid">' +
            '<div class="logo mark duo-mark lock-logo"><img src="icons/logo-mark.webp" width="168" height="168" alt=""></div>' +
            '<h2 class="page">' + title + '</h2>' +
            '<p class="lock-slogan" data-test="lock-slogan">' + esc(LOCK_SLOGAN) + '</p>' +
            dots(0) + padHtml + '<div class="ferr" id="gate-err"></div>' + err + forgot + help +
          '</div>' +
          '<div class="lock-foot">' + (bioBtn || '') + stamp + '</div>' +
          '</div>', { lock: true });
      } else {
        show('<div data-test="lock-screen"><h2 class="page">' + title + '</h2>' + dots(0) + padHtml + '<div class="ferr" id="gate-err"></div>' + err + help + '</div>');
      }
      if ($('gate-bio')) $('gate-bio').addEventListener('click', tryBio);
      if ($('gate-forgot-pass')) $('gate-forgot-pass').addEventListener('click', forgotPasscode);
      var entered = '';
      var first = '';
      var padEl = $('gate-pad');
      if (!padEl) return;
      padEl.addEventListener('click', function (e) {
        var b = e.target.closest('button'); if (!b) return;
        var key = b.getAttribute('data-key');
        if (key === 'del') entered = entered.slice(0, -1);
        else if (entered.length < 4) entered += key;
        var box = document.querySelector('#duoGate .duo-dots');
        if (box) box.outerHTML = dots(entered.length);
        if (entered.length < 4) return;
        if (kind === 'create') { first = entered; entered = ''; showLock('confirm'); showLock.pending = first; return; }
        if (kind === 'confirm') {
          var prev = showLock.pending || '';
          if (entered !== prev) { $('gate-err').textContent = 'Those passcodes don\'t match. Try again.'; showLock.pending = ''; setTimeout(function () { showLock('create'); }, 400); return; }
          Lock.seal(entered).then(function (rec) {
            rec.attempts = 0;
            return secretSet(rec);
          }).then(function () {
            prefs.enabled = true;
            prefs.userId = (ctx.currentUid && ctx.currentUid()) || prefs.userId || '';
            writePrefs(prefs);
            unlocked = true;
            cold = false;
            hide();
            renderLockCard();
            if (bioAvailable) offerBio();
            if (ctx.render) ctx.render();
          });
          return;
        }
        var attempt = Lock.canTry(secret, Date.now());
        if (!attempt.ok) { showLock('unlock'); return; }
        Lock.verify(entered, secret).then(function (ok) {
          if (ok) {
            Lock.recordSuccess(secret);
            secretSet(secret);
            unlocked = true;
            cold = false;
            hide();
            privacy(!!(prefs.enabled && prefs.hideInSwitcher) && document.hidden);
            return;
          }
          Lock.recordFailure(secret, Date.now());
          secretSet(secret);
          $('gate-err').textContent = secret.forceReauth ? 'Too many tries. Tap Forgot passcode? to reset it.' : 'That\'s not the passcode. Try again.';
          entered = '';
          setTimeout(function () { showLock('unlock'); }, secret.forceReauth ? 400 : 250);
        });
      });
    });
  }
  function tryBio() {
    var p = plugin('BiometricAuthNative');
    if (!p || !p.internalAuthenticate) { $('gate-err').textContent = 'Use your passcode instead.'; return; }
    p.internalAuthenticate({
      reason: 'Unlock Duo Budget',
      cancelTitle: 'Use passcode',
      allowDeviceCredential: false,
      iosFallbackTitle: 'Use passcode',
      androidTitle: 'Unlock Duo Budget',
      androidSubtitle: 'Confirm it\'s you'
    }).then(function () {
      unlocked = true;
      cold = false;
      hide();
    }).catch(function () {});
  }
  function offerBio() {
    if (!ctx.openSheet || !bioAvailable || prefs.biometrics) return;
    var name = bioName();
    ctx.openSheet('<h4>Use ' + esc(name) + ' too?</h4><p class="sub">Your passcode still works if ' + esc(name) + ' doesn\'t.</p><div class="btns"><button class="btn ghost" id="bio-no" type="button">Passcode only</button><button class="btn pri" id="bio-yes" type="button">Use ' + esc(name) + '</button></div>', function (sh) {
      sh.querySelector('#bio-no').addEventListener('click', function () { ctx.closeSheet(); });
      sh.querySelector('#bio-yes').addEventListener('click', function () { prefs.biometrics = true; writePrefs(prefs); ctx.closeSheet(); renderLockCard(); });
    });
  }
  function forgotPasscode() {
    var email = (ctx.currentEmail && ctx.currentEmail()) || '';
    show('<div data-test="forgot-screen"><h2 class="page">Forgot passcode?</h2><p class="sub">Sign in again as <b>' + esc(email || 'your account') + '</b> to set a new passcode. Your budget stays as it is.</p>' +
      (email ? '' : '<label class="fl" for="gate-email-input">Email</label><input class="field" id="gate-email-input" type="email">') +
      '<div class="ferr" id="gate-err"></div>' +
      '<button class="btn pri block" type="button" id="gate-reauth" data-test="reauth-send">Email a code</button>' +
      '<button class="linkbtn" type="button" id="gate-back">Back</button></div>');
    $('gate-back').addEventListener('click', function () { showLock('unlock'); });
    $('gate-reauth').addEventListener('click', function () {
      var addr = email || ($('gate-email-input') && $('gate-email-input').value.trim());
      if (!ctx.validEmail(addr)) { $('gate-err').textContent = 'Enter the email you signed up with.'; return; }
      if (email && addr.toLowerCase() !== email.toLowerCase()) { $('gate-err').textContent = 'That\'s not the email on this account.'; return; }
      ready().then(function (api) {
        return api.signInWithEmail(addr).then(function (r) {
          if (r && r.error) { $('gate-err').textContent = r.error.message || 'Couldn\'t send a code.'; return; }
          showCode(addr, 'email');
          mode = 'reauth-code';
        });
      });
    });
  }
  function openSetPassword(afterReset) {
    if (!ctx.openSheet) return;
    ctx.openSheet('<h4 data-test="set-password">' + (afterReset ? 'Choose a new password' : 'Set a password') + '</h4>' +
      '<p class="sub">At least 8 characters. You can still sign in with an email code. The password stays optional.</p>' +
      '<label class="fl" for="pw1">New password</label><input class="field" id="pw1" data-test="set-password-new" type="password" autocomplete="new-password">' +
      '<label class="fl" for="pw2">Confirm password</label><input class="field" id="pw2" data-test="set-password-confirm" type="password" autocomplete="new-password">' +
      '<div class="ferr" id="pw-err" data-test="set-password-err"></div>' +
      '<div class="btns"><button class="btn ghost" id="pw-cancel" type="button">Cancel</button><button class="btn pri" id="pw-save" type="button" data-test="set-password-save">Save password</button></div>', function (sh) {
      sh.querySelector('#pw-cancel').addEventListener('click', function () { ctx.closeSheet(); });
      sh.querySelector('#pw-save').addEventListener('click', function () {
        var a = sh.querySelector('#pw1').value, b = sh.querySelector('#pw2').value;
        var problem = Account.passwordProblem(a);
        if (problem) { sh.querySelector('#pw-err').textContent = problem; return; }
        if (a !== b) { sh.querySelector('#pw-err').textContent = 'Those passwords don\'t match.'; return; }
        ready().then(function (api) {
          return api.updatePassword(a).then(function (r) {
            if (r && r.error) { sh.querySelector('#pw-err').textContent = r.error.message || 'Couldn\'t save that password.'; return; }
            ctx.closeSheet();
            if (ctx.toast) ctx.toast('Password saved');
            renderAccount(lastStatus);
          });
        });
      });
    });
  }
  var lastStatus = null;
  function renderAccount(st) {
    lastStatus = st || lastStatus;
    var el = $('accountCard');
    if (!el) return;
    if (!st || !st.user) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    var p = providers();
    var links = '';
    if (p.apple) links += '<button class="btn ghost sm" type="button" id="link-apple">Link Apple</button>';
    if (p.google) links += '<button class="btn ghost sm" type="button" id="link-google">Link Google</button>';
    el.innerHTML = '<h3><span>Account</span></h3>' +
      '<div class="setrow"><div class="l">Signed in<small>' + esc(st.user) + '</small></div></div>' +
      '<div class="setrow"><div class="l">Password<small>Optional. The email code still works.</small></div><button class="btn ghost sm" type="button" id="set-password" data-test="set-password-open">Set a password</button></div>' +
      (links ? '<div class="setrow"><div class="l">Sign-in methods<small>Link another way into this same account. At least one method stays.</small></div><span class="duo-links">' + links + '</span></div>' : '') +
      '<p class="sub">Sign out removes this budget from this phone. The copy in your account stays.</p>' +
      '<button class="btn ghost block" type="button" id="account-out" data-test="sign-out-open">Sign out</button>' +
      '<p class="sub">Delete account removes the sign-in and the data tied to it.</p>' +
      '<button class="btn danger block" type="button" id="account-delete" data-test="delete-account">Delete my account and data</button>';
    var set = $('set-password'); if (set) set.addEventListener('click', function () { openSetPassword(false); });
    var out = $('account-out'); if (out) out.addEventListener('click', confirmSignOut);
    var del = $('account-delete'); if (del) del.addEventListener('click', confirmDelete);
    var la = $('link-apple'); if (la) la.addEventListener('click', function () { ready().then(function (api) { return api.linkIdentity('apple'); }); });
    var lg = $('link-google'); if (lg) lg.addEventListener('click', function () { ready().then(function (api) { return api.linkIdentity('google'); }); });
    ready().then(function (api) {
      if (!api || !api.identities) return;
      return api.identities().then(function (r) {
        var list = (r && r.data && r.data.identities) || [];
        if (list.length < 2 || !$('accountCard')) return;
        var box = document.createElement('div');
        list.forEach(function (id) {
          var row = document.createElement('div');
          row.className = 'setrow';
          row.innerHTML = '<div class="l">' + esc(id.provider || 'sign-in') + '</div>';
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn ghost sm';
          btn.textContent = 'Unlink';
          btn.addEventListener('click', function () {
            api.identities().then(function (again) {
              var left = (again && again.data && again.data.identities) || [];
              if (left.length <= 1) { if (ctx.toast) ctx.toast('Keep at least one way to sign in.'); return; }
              return api.unlinkIdentity(id);
            });
          });
          row.appendChild(btn);
          box.appendChild(row);
        });
        el.appendChild(box);
      });
    }).catch(function () {});
  }
  function renderLockCard() {
    var el = $('lockCard');
    if (!el) return;
    el.hidden = false;
    var signed = !!(lastStatus && lastStatus.user);
    if (!signed) {
      el.innerHTML = '<h3><span>App lock</span></h3><p class="sub" data-test="lock-settings">Sign in to lock Duo Budget on this phone.</p>' +
        '<button class="btn ghost block" type="button" id="lock-signin" data-test="lock-signin">Sign in</button>';
      var go = $('lock-signin');
      if (go) go.addEventListener('click', function () { openEmailSignIn(); });
      return;
    }
    var t = prefs.timeout || '1m';
    function radio(id, label) {
      return '<label class="duo-radio"><input type="radio" name="lock-after" value="' + id + '"' + (t === id ? ' checked' : '') + '> ' + label + '</label>';
    }
    var bio = bioAvailable ? '<div class="setrow"><div class="l">Use ' + esc(bioName()) + '<small>The passcode still works if this doesn\'t.</small></div><input type="checkbox" id="lock-bio"' + (prefs.biometrics ? ' checked' : '') + (prefs.enabled ? '' : ' disabled') + '></div>' : '';
    var web = platform() === 'web' ? '<p class="mock">On the web this is a privacy curtain for this browser, not a strong lock. Face ID on the web can come later.</p>' : '';
    el.innerHTML = '<h3><span>App lock</span></h3><div data-test="lock-settings">' +
      '<div class="setrow"><div class="l">Lock Duo Budget<small>Off until you turn it on. A 4-digit passcode is stored as a salted hash on this device.</small></div><input type="checkbox" id="lock-on" data-test="lock-enable"' + (prefs.enabled ? ' checked' : '') + '></div>' +
      bio +
      '<div class="setrow"><div class="l">Change passcode</div><button class="btn ghost sm" type="button" id="lock-change"' + (prefs.enabled ? '' : ' disabled') + '>Change</button></div>' +
      '<div class="lock-after"><div class="l">Lock after</div>' + radio('immediate', 'Immediately') + radio('1m', 'After 1 minute') + radio('5m', 'After 5 minutes') + '</div>' +
      '<div class="setrow"><div class="l">Hide in the app switcher<small>On Android this also blocks screenshots while the lock is on.</small></div><input type="checkbox" id="lock-hide"' + (prefs.hideInSwitcher ? ' checked' : '') + '></div>' +
      web + '</div>';
    $('lock-on').addEventListener('change', function () {
      if (this.checked) { this.checked = false; showLock('create'); return; }
      prefs.enabled = false;
      prefs.biometrics = false;
      writePrefs(prefs);
      secretClear();
      renderLockCard();
    });
    var bioBox = $('lock-bio');
    if (bioBox) bioBox.addEventListener('change', function () { prefs.biometrics = this.checked; writePrefs(prefs); });
    $('lock-hide').addEventListener('change', function () { prefs.hideInSwitcher = this.checked; writePrefs(prefs); });
    $('lock-change').addEventListener('click', function () { if (prefs.enabled) showLock('create'); });
    [].forEach.call(el.querySelectorAll('input[name="lock-after"]'), function (input) {
      input.addEventListener('change', function () { prefs.timeout = this.value; writePrefs(prefs); });
    });
  }
  function renderNudge() {
    var el = $('backupNudge');
    if (!el) return;
    var g = Account.readGate(storage());
    if (!plan || !plan.nudge || g.backupNudge || (lastStatus && lastStatus.user)) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = '<h3><span>Back up this budget</span></h3><p class="sub">Create an account to sync with your partner and keep this budget if you lose this phone.</p>' +
      '<button class="btn pri block" type="button" id="nudge-go" data-test="backup-nudge">Create an account</button>' +
      '<button class="linkbtn" type="button" id="nudge-no">Not now</button>';
    $('nudge-go').addEventListener('click', function () { openEmailSignIn(); });
    $('nudge-no').addEventListener('click', function () {
      var gate = Account.readGate(storage());
      gate.backupNudge = true;
      Account.writeGate(storage(), gate);
      el.hidden = true;
    });
  }
  function confirmSignOut() {
    var pending = lastStatus && lastStatus.pending || 0;
    var extra = pending ? '<p class="sub">' + pending + ' change' + (pending === 1 ? '' : 's') + ' haven\'t synced. Sign out anyway?</p>' : '';
    ctx.openSheet('<h4 data-test="sign-out-confirm">Sign out of this phone?</h4>' +
      '<p class="sub">This removes the budget from this phone. The copy in your account stays safe. You can sign in again to bring it back.</p>' + extra +
      '<div class="btns"><button class="btn ghost" id="out-no" type="button">Cancel</button><button class="btn danger" id="out-yes" type="button" data-test="sign-out-yes">Sign out</button></div>', function (sh) {
      sh.querySelector('#out-no').addEventListener('click', function () { ctx.closeSheet(); });
      sh.querySelector('#out-yes').addEventListener('click', function () {
        ctx.closeSheet();
        doSignOut(false);
      });
    });
  }
  function doSignOut(inactive) {
    var api = sync();
    var uid = (ctx.currentUid && ctx.currentUid()) || (lastStatus && lastStatus.uid) || '';
    var pending = api && api.flush ? api.flush() : Promise.resolve();
    Promise.resolve(pending).catch(function () {}).then(function () {
      var off = api && api.signOut ? api.signOut() : Promise.resolve();
      return Promise.resolve(off);
    }).catch(function () {}).then(function () {
      if (api && api.stop) api.stop();
      Account.wipeDevice(storage(), uid);
      try { storage().removeItem(PREFS_KEY); } catch (e) {}
      secretClear();
      var g = Account.emptyGate ? null : Account.readGate(storage());
      g = { v: 1, guest: false, owner: null, welcomeDone: false, backupNudge: false, lockOffered: false, pendingGuest: false, inactiveSignOut: !!inactive, lastActive: 0 };
      Account.writeGate(storage(), g);
      prefs = Lock.defaultPrefs();
      unlocked = false;
      cold = true;
      if (ctx.setSampleOnly) ctx.setSampleOnly(true);
      if (ctx.setKey) ctx.setKey(Account.LEGACY_KEY);
      if (ctx.setState) ctx.setState(ctx.blank());
      plan = { screen: 'welcome', reason: inactive ? 'inactive' : '', localIsGuest: false };
      if (ctx.render) ctx.render();
      showWelcome();
      if (ctx.restartSync) ctx.restartSync();
    });
  }
  function confirmDelete() {
    ctx.openSheet('<h4>Delete your account and data?</h4><p class="sub">This deletes your sign-in and the budget data tied to it. If your partner is still in a shared household, the shared lines stay with them and your name is removed. The copy on this phone is removed too. This can\'t be undone.</p>' +
      '<div class="btns"><button class="btn ghost" id="del-no" type="button">Cancel</button><button class="btn danger" id="del-yes" type="button" data-test="delete-confirm">Delete account</button></div>', function (sh) {
      sh.querySelector('#del-no').addEventListener('click', function () { ctx.closeSheet(); });
      sh.querySelector('#del-yes').addEventListener('click', function () {
        sh.querySelector('#del-yes').disabled = true;
        ready().then(function (api) {
          return api.deleteAccount().then(function (r) {
            ctx.closeSheet();
            if (r && r.authUserRemains && ctx.toast) ctx.toast('Budget data was deleted. The sign-in itself is removed once delete-account is on the server. You can also email support@duobudget.com.au.');
            if (r && r.error && ctx.toast) { ctx.toast(r.error.message || 'Couldn\'t delete the account.'); return; }
            doSignOut(false);
          });
        });
      });
    });
  }
  function onSync(st) {
    if (!st) return;
    lastStatus = st;
    if (st.uid && Account.touchActive) Account.touchActive(storage(), Date.now());
    renderAccount(st);
    renderLockCard();
    renderNudge();
    if (st.user && ctx.sampleOnly && ctx.sampleOnly() && st.uid && st.state !== 'starting') {
      if (ctx.leaveSample) ctx.leaveSample(st.uid);
      return;
    }
    if (st.user && (mode === 'welcome' || mode === 'email' || mode === 'code' || mode === 'password')) {
      var back = emailReturn;
      emailReturn = null;
      hide();
      if (typeof back === 'function') back();
    }
    if (mode === 'reauth-code' && st.user) {
      var uid = st.uid || '';
      if (prefs.userId && uid && prefs.userId !== uid) {
        show('<div><h2 class="page">That was a different account</h2><p class="sub">Sign in with the account that set this lock. Cloud data was not deleted.</p><button class="btn pri block" id="gate-back" type="button">Back</button></div>');
        $('gate-back').addEventListener('click', function () { showLock('unlock'); });
        return;
      }
      secretClear().then(function () {
        prefs.enabled = false;
        writePrefs(prefs);
        showLock('create');
      });
      return;
    }
    if (st.user && prefs.enabled && !unlocked && (cold || Lock.shouldLock(prefs, { coldStart: cold, backgroundAt: backgroundAt, now: Date.now() }))) {
      showLock('unlock');
      return;
    }
    if (st.user && !prefs.enabled && !lockOffered && !Account.readGate(storage()).lockOffered && st.state !== 'starting' && st.state !== 'choose-budget' && ctx.openSheet) {
      lockOffered = true;
      var g = Account.readGate(storage());
      g.lockOffered = true;
      Account.writeGate(storage(), g);
      ctx.openSheet('<h4>Lock Duo Budget on this phone?</h4><p class="sub">A 4-digit passcode, plus Face ID, Touch ID or fingerprint where the phone has it. It stays on this device and does not change your account.</p><div class="btns"><button class="btn ghost" id="lock-later" type="button">Not now</button><button class="btn pri" id="lock-now" type="button">Set a passcode</button></div>', function (sh) {
        sh.querySelector('#lock-later').addEventListener('click', function () { ctx.closeSheet(); });
        sh.querySelector('#lock-now').addEventListener('click', function () { ctx.closeSheet(); showLock('create'); });
      });
    }
  }
  function isGuestBudget() {
    var g = Account.readGate(storage());
    return g.owner === 'guest' || !!g.pendingGuest;
  }
  function onBackground() {
    backgroundAt = Date.now();
    if (prefs.enabled && prefs.hideInSwitcher) {
      document.documentElement.classList.add('duo-privacy');
      privacy(true);
    }
  }
  function onForeground() {
    if (!(prefs.enabled && !unlocked)) document.documentElement.classList.remove('duo-privacy');
    if (!prefs.enabled) return;
    if (Lock.shouldLock(prefs, { coldStart: false, backgroundAt: backgroundAt, now: Date.now() })) {
      unlocked = false;
      showLock('unlock');
    }
  }
  function bindLifecycle() {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) onBackground();
      else onForeground();
    });
    var app = plugin('App');
    if (app && app.addListener) {
      app.addListener('appStateChange', function (state) {
        if (!state || !state.isActive) onBackground();
        else onForeground();
      });
    }
  }
  function start(next) {
    ctx = next;
    plan = next.plan || { screen: 'app' };
    prefs = readPrefs();
    refreshBio();
    bindLifecycle();
    if (plan.screen === 'welcome') showWelcome();
    else hide();
    renderNudge();
    renderLockCard();
    if (prefs.enabled && plan.signedIn) {
      unlocked = false;
      cold = true;
      showLock('unlock');
    }
    return plan;
  }
  return {
    start: start,
    onSync: onSync,
    askLink: askLink,
    confirmSignOut: confirmSignOut,
    openSetPassword: openSetPassword,
    isGuestBudget: isGuestBudget,
    showWelcome: showWelcome,
    startProvider: startProvider,
    openEmailSignIn: openEmailSignIn
  };
});
