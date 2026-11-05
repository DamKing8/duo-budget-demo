/* Household Premium rules. No network. The page and the tests share this file.
   A real RevenueCat key switches off the mock. Stripe is a later seam. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DuoPremium = factory();
})(this, function () {
  'use strict';
  var FREE = { goals: 2, historyMonths: 3, categories: 5, reminders: 1, forecastCycles: 1 };
  var OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
  var COURTESY_MS = 14 * 24 * 60 * 60 * 1000;
  var TRIAL_MS = 14 * 24 * 60 * 60 * 1000;
  var LIVE = { trialing: 1, active: 1, grace: 1, billing_retry: 1 };
  var PRODUCTS = {
    monthly: { id: 'duo_premium_monthly', price: 'A$4.99', period: 'month', trialDays: 14 },
    annual: { id: 'duo_premium_annual', price: 'A$39.99', period: 'year', trialDays: 14, featured: true }
  };
  var ENTITLEMENT_ID = 'premium';
  var OFFERING_ID = 'default';

  function monthsAgo(now, n) {
    var d = new Date(now);
    d.setMonth(d.getMonth() - n);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function isPremium(row, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    if (!row || !LIVE[row.status]) return false;
    if (!row.expires_at) return true;
    var exp = Date.parse(row.expires_at);
    if (!(exp > 0)) return false;
    if (now < exp) return true;
    if (opts.offline && now < exp + OFFLINE_GRACE_MS) return true;
    return false;
  }
  function lapsed(row, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    if (!row || isPremium(row, opts)) return false;
    if (row.status === 'revoked') return true;
    if (!row.trial_used) return false;
    return row.status === 'expired' || (!!row.expires_at && Date.parse(row.expires_at) <= now);
  }
  function goalLocked(index, premium) {
    return !premium && index >= FREE.goals;
  }
  function canAddGoal(count, premium) {
    return premium || count < FREE.goals;
  }
  function historyCutoff(now) { return monthsAgo(now || Date.now(), FREE.historyMonths); }
  function historyVisible(date, premium, now) {
    if (premium) return true;
    var t = date instanceof Date ? +date : Date.parse(date);
    if (!(t > 0)) return true;
    return t >= +historyCutoff(now || Date.now());
  }
  function canAddCategory(count, premium) { return premium || count < FREE.categories; }
  function categoryLocked(index, premium) { return !premium && index >= FREE.categories; }
  function canAddReminder(count, premium) { return premium || count < FREE.reminders; }
  function reminderLocked(index, premium) { return !premium && index >= FREE.reminders; }
  function forecastCycles(premium) { return premium ? 6 : FREE.forecastCycles; }
  function accentAllowed(accent, premium) {
    if (!accent || accent === 'teal') return true;
    return !!premium;
  }
  function mockRow(state, now) {
    now = now || Date.now();
    var iso = function (ms) { return new Date(ms).toISOString(); };
    if (state === 'trial') return { status: 'trialing', expires_at: iso(now + TRIAL_MS), trial_used: true, store: 'promo', product_id: PRODUCTS.annual.id };
    if (state === 'active') return { status: 'active', expires_at: iso(now + 30 * 24 * 60 * 60 * 1000), trial_used: true, store: 'app_store', product_id: PRODUCTS.annual.id, payer_name: 'You' };
    if (state === 'partner') return { status: 'active', expires_at: iso(now + 30 * 24 * 60 * 60 * 1000), trial_used: true, store: 'play_store', product_id: PRODUCTS.monthly.id, covered: true, payer_name: 'Chloe' };
    if (state === 'courtesy') return { status: 'grace', expires_at: iso(now + COURTESY_MS), trial_used: true, courtesy: true, payer_name: 'Chloe' };
    if (state === 'lapsed') return { status: 'expired', expires_at: iso(now - 24 * 60 * 60 * 1000), trial_used: true, store: 'app_store', product_id: PRODUCTS.annual.id };
    return { status: 'expired', expires_at: iso(now - 24 * 60 * 60 * 1000), trial_used: false };
  }
  function readJson(store, key) {
    try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function resolve(row, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    return { row: row || null, premium: isPremium(row, { now: now, offline: !!opts.offline }), lapsed: lapsed(row, { now: now }) };
  }
  /* Payer leaves: Premium follows them. The household they left keeps a 14-day courtesy. */
  function payerLeft(row, now) {
    now = now || Date.now();
    var next = Object.assign({}, row || {});
    next.status = 'grace';
    next.courtesy = true;
    next.expires_at = new Date(now + COURTESY_MS).toISOString();
    return next;
  }
  function paywallKind(row, opts) {
    var view = resolve(row, opts);
    if (view.premium && row && row.covered) return 'covered';
    if (view.premium) return 'already';
    return 'offer';
  }
  function trialAvailable(row) {
    return !(row && row.trial_used);
  }
  /* Second purchase: the household is already covered, so the paywall must not sell again. */
  function blockSecondPurchase(row, opts) {
    return paywallKind(row, opts) !== 'offer';
  }
  function webCheckout() {
    return { ok: false, later: true, reason: 'stripe-later' };
  }
  return {
    FREE: FREE, OFFLINE_GRACE_MS: OFFLINE_GRACE_MS, COURTESY_MS: COURTESY_MS, TRIAL_MS: TRIAL_MS,
    PRODUCTS: PRODUCTS, ENTITLEMENT_ID: ENTITLEMENT_ID, OFFERING_ID: OFFERING_ID,
    isPremium: isPremium, lapsed: lapsed, goalLocked: goalLocked, canAddGoal: canAddGoal,
    historyCutoff: historyCutoff, historyVisible: historyVisible,
    canAddCategory: canAddCategory, categoryLocked: categoryLocked,
    canAddReminder: canAddReminder, reminderLocked: reminderLocked,
    forecastCycles: forecastCycles, accentAllowed: accentAllowed,
    mockRow: mockRow, readJson: readJson, resolve: resolve, payerLeft: payerLeft,
    paywallKind: paywallKind, trialAvailable: trialAvailable, blockSecondPurchase: blockSecondPurchase,
    webCheckout: webCheckout, monthsAgo: monthsAgo
  };
});
