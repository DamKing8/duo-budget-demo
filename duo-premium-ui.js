/* Premium screens. Talks to DuoPremium for the rules and never calls a store
   unless a RevenueCat key is configured. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DuoPremiumUI = factory();
})(this, function () {
  'use strict';
  var P = typeof DuoPremium !== 'undefined' ? DuoPremium : null;
  var MOCK_KEY = 'duoBudget.premium.mock';
  var ACCENT_KEY = 'duoBudget.accent';
  var ACCENTS = [['teal', 'Teal'], ['plum', 'Plum'], ['sand', 'Sand'], ['forest', 'Forest']];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function readMock(store) {
    try {
      var m = JSON.parse(store.getItem(MOCK_KEY) || 'null');
      if (m && m.state) return m;
    } catch (e) {}
    return { state: 'free', storePurchase: false };
  }
  function writeMock(store, patch) {
    var cur = readMock(store);
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    store.setItem(MOCK_KEY, JSON.stringify(cur));
    return cur;
  }

  function install(ctx) {
    var store = ctx.storage;
    function cfg() { return ctx.config() || {}; }
    function usingMock() {
      var c = cfg();
      return c.mock !== false && !c.revenueCatKey && !c.revenueCatAppleKey && !c.revenueCatGoogleKey;
    }
    function view() {
      if (usingMock()) return P.resolve(P.mockRow(readMock(store).state, Date.now()), { now: Date.now() });
      var cache = null;
      try { cache = JSON.parse(store.getItem('duoBudget.premium.cache') || 'null'); } catch (e) {}
      return P.resolve(cache && cache.row, { now: Date.now(), offline: ctx.offline ? ctx.offline() : !navigator.onLine });
    }
    function premium() { return view().premium; }
    function openPaywall(feature) {
      var v = view();
      var signed = ctx.signedIn ? ctx.signedIn() : false;
      if (P.paywallKind(v.row, { now: Date.now() }) === 'covered') {
        ctx.openSheet('<h4 data-test="partner-covered">Premium is on</h4><p class="sub">' + esc(v.row.payer_name || 'Your partner') + '\'s subscription covers you both. Nothing to buy.</p><button class="btn pri block" type="button" id="pw-close">Close</button>', function (sh) {
          sh.querySelector('#pw-close').addEventListener('click', ctx.closeSheet);
        });
        return;
      }
      if (P.paywallKind(v.row, { now: Date.now() }) === 'already') {
        ctx.openSheet('<h4>Premium is on</h4><p class="sub">This household already has Premium. A second subscription is not needed.</p><button class="btn pri block" type="button" id="pw-close">Close</button>', function (sh) {
          sh.querySelector('#pw-close').addEventListener('click', ctx.closeSheet);
        });
        return;
      }
      if (!signed) {
        ctx.openSheet('<h4 data-test="paywall">Duo Premium</h4><p class="sub">Sign in to subscribe. Your free plan stays on this phone either way.</p><button class="btn pri block" type="button" id="pw-signin">Continue to sign in</button>', function (sh) {
          sh.querySelector('#pw-signin').addEventListener('click', function () { ctx.closeSheet(); if (ctx.openPartner) ctx.openPartner(); });
        });
        return;
      }
      var trial = P.trialAvailable(v.row);
      var why = feature === 'goals' ? 'Want a third goal? That\'s part of Premium.'
        : feature === 'history' ? 'Looking back more than 3 months is part of Premium.'
        : feature === 'themes' ? 'Extra colours are part of Premium. Light and dark mode stay free.'
        : feature === 'forecast' ? 'Planning past your next payday is part of Premium.'
        : feature === 'categories' ? 'Free includes 5 custom categories. Premium adds more.'
        : feature === 'reminders' ? 'Free includes 1 bill reminder. Premium adds more.'
        : 'One subscription covers you both.';
      if (!document.getElementById('pw-best-style')) {
        var style = document.createElement('style');
        style.id = 'pw-best-style';
        style.textContent = '#pw-annual{display:flex;align-items:center;justify-content:center;gap:8px}.pw-best{font-size:12px;font-weight:800;letter-spacing:.02em;line-height:1.2;padding:3px 8px;border-radius:999px;background:rgba(0,0,0,.16)}';
        document.head.appendChild(style);
      }
      ctx.openSheet('<h4 data-test="paywall">Duo Premium</h4><p class="sub">' + esc(why) + '</p>' +
        (trial ? '<p class="sub">Try it free for 14 days. One trial per household.</p>' : '<p class="sub">Your household has already had its free trial.</p>') +
        '<button class="btn pri block" type="button" id="pw-annual" data-test="plan-annual"><span class="pw-best">Best value</span><span>' + esc(P.PRODUCTS.annual.price) + ' a year</span></button>' +
        '<button class="btn ghost block" type="button" id="pw-month" data-test="plan-monthly" style="margin-top:8px">' + esc(P.PRODUCTS.monthly.price) + ' a month</button>' +
        '<p class="mock">Paid through the App Store or Google Play.</p>', function (sh) {
        function buy(id) {
          if (!usingMock()) { ctx.toast('Store billing is not configured on this build yet.'); return; }
          var state = trial ? 'trial' : 'active';
          writeMock(store, { state: state });
          ctx.closeSheet();
          ctx.toast(trial ? 'Trial started on this device preview.' : 'Premium preview is on.');
          if (ctx.render) ctx.render();
          paint();
        }
        sh.querySelector('#pw-annual').addEventListener('click', function () { buy(P.PRODUCTS.annual.id); });
        sh.querySelector('#pw-month').addEventListener('click', function () { buy(P.PRODUCTS.monthly.id); });
      });
    }
    function restore() {
      if (!usingMock()) {
        var cap = window.Capacitor;
        var Purchases = cap && cap.Plugins && cap.Plugins.Purchases;
        if (Purchases && Purchases.restorePurchases) {
          Purchases.restorePurchases().then(function () {
            ctx.openSheet('<h4 data-test="restore-result">Restore purchases</h4><p class="sub">If this store account has a subscription, we\'ve asked the store to restore it. This screen does not switch to Premium on its own yet.</p><button class="btn pri block" id="rs-close" type="button">Close</button>', function (sh) {
              sh.querySelector('#rs-close').addEventListener('click', ctx.closeSheet);
            });
          }).catch(function () { ctx.toast('We couldn\'t reach the store. Try again soon.'); });
          return;
        }
      }
      var mock = readMock(store);
      if (mock.storePurchase) {
        writeMock(store, { state: 'active', storePurchase: true });
        ctx.openSheet('<h4 data-test="restore-result">Purchases restored</h4><p class="sub">Premium covers this household. Your partner is included.</p><button class="btn pri block" id="rs-close" type="button">Close</button>', function (sh) {
          sh.querySelector('#rs-close').addEventListener('click', function () { ctx.closeSheet(); if (ctx.render) ctx.render(); paint(); });
        });
        return;
      }
      ctx.openSheet('<h4 data-test="restore-result">Restore purchases</h4><p class="sub">We didn\'t find a purchase on this store account.</p><button class="btn pri block" id="rs-close" type="button">Close</button>', function (sh) {
        sh.querySelector('#rs-close').addEventListener('click', ctx.closeSheet);
      });
    }
    function applyAccent() {
      var accent = '';
      try { accent = store.getItem(ACCENT_KEY) || ''; } catch (e) {}
      if (accent && accent !== 'teal') document.documentElement.setAttribute('data-accent', accent);
      else document.documentElement.removeAttribute('data-accent');
    }
    function paint() {
      applyAccent();
      var card = document.getElementById('premiumCard');
      if (!card) return;
      card.hidden = false;
      var v = view();
      var status = 'Free plan';
      if (v.premium && v.row && v.row.covered) status = 'Premium is on. ' + (v.row.payer_name || 'Your partner') + '\'s subscription covers you both.';
      else if (v.premium && v.row && v.row.status === 'trialing') status = 'Your Premium trial is on.';
      else if (v.premium && v.row && v.row.courtesy) status = 'Premium stays on for 14 days after the person who paid leaves.';
      else if (v.premium) status = 'Premium is on for this household.';
      else if (v.lapsed) status = 'Premium has ended. Extra goals and history are now read-only. Nothing\'s been deleted.';
      var mock = usingMock();
      var states = ['free', 'trial', 'active', 'lapsed', 'partner', 'courtesy'];
      card.innerHTML = '<h3><span>Premium</span></h3><p class="sub" data-test="premium-status"' + (v.row && v.row.covered ? ' data-covered="1"' : '') + '>' + esc(status) + '</p>' +
        (v.row && v.row.covered ? '<p data-test="partner-covered">' + esc(v.row.payer_name || 'Your partner') + ' covers this household.</p>' : '') +
        '<button class="btn ghost block" type="button" id="premium-restore" data-test="restore-purchases">Restore purchases</button>' +
        '<button class="btn pri block" type="button" id="premium-see" data-test="see-premium" style="margin-top:8px">See Premium</button>' +
        (mock ? '<div class="hint" style="margin-top:10px">Preview only. No store is contacted.</div><div class="chips" id="premium-mock" data-test="premium-preview">' + states.map(function (s) {
          return '<button type="button" class="chip' + (readMock(store).state === s ? ' on' : '') + '" data-mock="' + s + '">' + s + '</button>';
        }).join('') + '</div><label class="duo-radio"><input type="checkbox" id="premium-store"' + (readMock(store).storePurchase ? ' checked' : '') + '> This store account has a purchase</label>' : '');
      var restoreBtn = document.getElementById('premium-restore');
      if (restoreBtn) restoreBtn.addEventListener('click', restore);
      var see = document.getElementById('premium-see');
      if (see) see.addEventListener('click', function () { openPaywall('general'); });
      var chips = document.getElementById('premium-mock');
      if (chips) chips.addEventListener('click', function (e) {
        var b = e.target.closest('[data-mock]'); if (!b) return;
        writeMock(store, { state: b.getAttribute('data-mock') });
        if (ctx.render) ctx.render();
        paint();
      });
      var box = document.getElementById('premium-store');
      if (box) box.addEventListener('change', function () { writeMock(store, { storePurchase: box.checked }); });
      paintLists();
      paintAccents();
    }
    function paintLists() {
      var host = document.getElementById('premiumExtras');
      if (!host) return;
      var S = ctx.getS();
      var on = premium();
      var cats = S.customCategories || [];
      var rems = S.reminders || [];
      host.hidden = false;
      host.innerHTML = '<h3><span>Categories and reminders</span></h3>' +
        '<p class="sub">' + cats.length + ' of ' + (on ? 'unlimited' : String(P.FREE.categories)) + ' custom categories. ' + rems.length + ' of ' + (on ? 'unlimited' : String(P.FREE.reminders)) + ' bill reminders.</p>' +
        '<button class="btn ghost block" type="button" id="add-cat" data-test="add-category">Add a category</button>' +
        '<button class="btn ghost block" type="button" id="add-rem" data-test="add-reminder" style="margin-top:8px">Add a bill reminder</button>';
      document.getElementById('add-cat').addEventListener('click', function () {
        if (!P.canAddCategory(cats.length, on)) { openPaywall('categories'); return; }
        var name = 'Category ' + (cats.length + 1);
        S.customCategories = cats.concat([{ id: ctx.uid(), name: name }]);
        ctx.save(); paint();
      });
      document.getElementById('add-rem').addEventListener('click', function () {
        if (!P.canAddReminder(rems.length, on)) { openPaywall('reminders'); return; }
        S.reminders = rems.concat([{ id: ctx.uid(), name: 'Bill', daysBefore: 2 }]);
        ctx.save(); paint();
      });
    }
    function paintAccents() {
      var card = document.querySelector('[data-test="theme-card"]');
      if (!card || card.querySelector('#accent-row')) return;
      var row = document.createElement('div');
      row.id = 'accent-row';
      row.innerHTML = '<label class="fl">Colour</label><div class="chips" id="accent-chips"></div><p class="mock">Light, dark and system stay free.</p>';
      card.appendChild(row);
      function draw() {
        var cur = '';
        try { cur = store.getItem(ACCENT_KEY) || 'teal'; } catch (e) { cur = 'teal'; }
        document.getElementById('accent-chips').innerHTML = ACCENTS.map(function (a) {
          return '<button type="button" class="chip' + ((cur || 'teal') === a[0] ? ' on' : '') + '" data-accent="' + a[0] + '">' + a[1] + '</button>';
        }).join('');
      }
      draw();
      document.getElementById('accent-chips').addEventListener('click', function (e) {
        var b = e.target.closest('[data-accent]'); if (!b) return;
        var accent = b.getAttribute('data-accent');
        var cur = store.getItem(ACCENT_KEY) || 'teal';
        if (accent !== cur && !P.accentAllowed(accent, premium())) { openPaywall('themes'); return; }
        try { store.setItem(ACCENT_KEY, accent === 'teal' ? '' : accent); } catch (err) {}
        applyAccent();
        draw();
      });
    }
    function forecastHtml() {
      var on = premium();
      var n = P.forecastCycles(on);
      var cycles = ctx.forecast ? ctx.forecast(6) : [];
      var shown = cycles.slice(0, n);
      var html = '<div class="card" id="forecastCard" data-test="forecast-card"><h3><span>Looking ahead</span></h3><p class="sub">What is left until payday stays free. The further paydays are Premium.</p>';
      shown.forEach(function (c, i) {
        html += '<div class="setrow"><div class="l">' + esc(c.label) + '</div><b>' + esc(c.left) + '</b></div>';
      });
      if (!on) html += '<button class="btn ghost block" type="button" id="forecast-more" data-test="forecast-more">See the next 5 paydays</button>';
      return html + '</div>';
    }
    paint();
    var cycle = document.getElementById('v-cycle');
    if (cycle && !document.getElementById('forecastCard')) cycle.insertAdjacentHTML('beforeend', forecastHtml());
    var more = document.getElementById('forecast-more');
    if (more) more.addEventListener('click', function () { openPaywall('forecast'); });

    var nativeKey = cfg().revenueCatKey || cfg().revenueCatAppleKey || cfg().revenueCatGoogleKey;
    if (nativeKey && ctx.userId && ctx.userId()) {
      try {
        var cap = window.Capacitor;
        var Purchases = cap && cap.Plugins && cap.Plugins.Purchases;
        if (Purchases && Purchases.configure) {
          var platform = cap.getPlatform ? cap.getPlatform() : '';
          var key = platform === 'ios' ? (cfg().revenueCatAppleKey || nativeKey) : platform === 'android' ? (cfg().revenueCatGoogleKey || nativeKey) : nativeKey;
          if (key) Purchases.configure({ apiKey: key, appUserID: ctx.userId() }).catch(function () {});
        }
      } catch (e) {}
    }

    return {
      openPaywall: openPaywall,
      premium: premium,
      goalForm: function (orig) {
        return function (g) {
          var goals = ctx.getS().goals || [];
          if (!g && !P.canAddGoal(goals.length, premium())) { openPaywall('goals'); return; }
          if (g) {
            var idx = goals.indexOf(g);
            if (idx < 0) idx = goals.findIndex(function (x) { return x.id === g.id; });
            if (P.goalLocked(idx, premium())) { openReadonly(g, true); return; }
          }
          return orig(g);
        };
      },
      goalDetail: function (orig) {
        return function (id) {
          var goals = ctx.getS().goals || [];
          var idx = goals.findIndex(function (x) { return x.id === id; });
          if (P.goalLocked(idx, premium())) { openReadonly(goals[idx], view().lapsed); return; }
          return orig(id);
        };
      },
      renderGoals: function (orig) {
        return function () {
          orig();
          var goals = ctx.getS().goals || [];
          var on = premium();
          var byId = {};
          goals.forEach(function (g, i) { byId[g.id] = i; });
          [].forEach.call(document.querySelectorAll('#goals .goal'), function (card) {
            var i = byId[card.getAttribute('data-gid')];
            if (!P.goalLocked(i, on)) return;
            card.setAttribute('data-test', 'goal-locked');
            card.setAttribute('data-locked', '1');
            var note = document.createElement('div');
            note.className = 'hint';
            note.textContent = 'Read-only. Nothing was deleted.';
            card.appendChild(note);
          });
          var existingLimit = document.getElementById('goal-limit');
          if (on && existingLimit) existingLimit.remove();
          if (!on && goals.length >= P.FREE.goals) {
            var sub = document.getElementById('goalsSub');
            if (sub && !document.getElementById('goal-limit')) {
              var p = document.createElement('p');
              p.id = 'goal-limit';
              p.className = 'sub';
              p.setAttribute('data-test', 'goal-limit');
              p.textContent = 'Two goals are included. Another goal is part of Premium.';
              sub.insertAdjacentElement('afterend', p);
            }
          }
        };
      },
      renderSpent: function (orig) {
        return function () {
          var win = ctx.currentSpendWindow(ctx.spendOff());
          var visible = P.historyVisible(win.start, premium(), Date.now());
          orig();
          if (visible) return;
          var list = document.getElementById('spendList');
          if (list) list.innerHTML = '<div class="card" data-test="history-limit"><b>Older spending stays saved.</b><div class="sub">The free plan shows 3 months. Premium shows the rest. Nothing is deleted.</div><button class="btn pri block" type="button" id="history-premium">See Premium</button></div>';
          var btn = document.getElementById('history-premium');
          if (btn) btn.addEventListener('click', function () { openPaywall('history'); });
          var prev = document.getElementById('spentPrev');
          if (prev) prev.disabled = true;
        };
      },
      renderTrends: function (orig) {
        return function () {
          orig();
          if (premium()) return;
          var body = document.getElementById('trBody');
          if (!body || document.getElementById('history-trend')) return;
          var note = document.createElement('div');
          note.id = 'history-trend';
          note.className = 'card tr-full';
          note.setAttribute('data-test', 'history-trend');
          note.innerHTML = '<b>Trends past 3 months are hidden.</b><div class="sub">The spending is still saved and still syncs. Premium shows it.</div>';
          body.appendChild(note);
        };
      },
      renderCycle: function (orig) {
        return function () {
          orig();
          var old = document.getElementById('forecastCard');
          if (old) old.remove();
          var cycle = document.getElementById('v-cycle');
          if (!cycle) return;
          cycle.insertAdjacentHTML('beforeend', forecastHtml());
          var again = document.getElementById('forecast-more');
          if (again) again.addEventListener('click', function () { openPaywall('forecast'); });
        };
      }
    };
    function openReadonly(g, ended) {
      ctx.openSheet('<h4 data-test="goal-readonly">' + esc(g && g.name || 'Goal') + '</h4><p class="sub">' + (ended ? 'Premium has ended. This goal is read-only. Nothing\'s been deleted.' : 'On the free plan this goal is read-only. Nothing\'s been deleted.') + '</p><button class="btn pri block" type="button" id="ro-premium">See Premium</button><button class="btn ghost block" type="button" id="ro-close" style="margin-top:8px">Close</button>', function (sh) {
        sh.querySelector('#ro-close').addEventListener('click', ctx.closeSheet);
        sh.querySelector('#ro-premium').addEventListener('click', function () { ctx.closeSheet(); openPaywall('goals'); });
      });
    }
  }
  return { install: install, MOCK_KEY: MOCK_KEY };
});
