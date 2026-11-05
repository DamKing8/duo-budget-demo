#!/usr/bin/env node
'use strict';
var P = require('../../duo-premium.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

var now = Date.parse('2026-11-04T00:00:00.000Z');
var month = 30 * 24 * 60 * 60 * 1000;

assert(P.PRODUCTS.monthly.price === 'A$4.99' && P.PRODUCTS.annual.price === 'A$39.99', 'prices stay A$4.99 and A$39.99');
assert(P.PRODUCTS.monthly.id === 'duo_premium_monthly' && P.PRODUCTS.annual.id === 'duo_premium_annual', 'product ids');
assert(P.ENTITLEMENT_ID === 'premium' && P.OFFERING_ID === 'default', 'entitlement and offering ids');
assert(P.webCheckout().later === true, 'Stripe stays a later seam');

var active = { status: 'active', expires_at: new Date(now + month).toISOString() };
var trial = P.mockRow('trial', now);
var lapsed = P.mockRow('lapsed', now);
var partner = P.mockRow('partner', now);
assert(P.isPremium(active, { now: now }), 'an active row is Premium');
assert(P.isPremium(trial, { now: now }), 'a trial is Premium');
assert(!P.isPremium(lapsed, { now: now }) && P.lapsed(lapsed, { now: now }), 'a lapsed row is not Premium and is marked lapsed');
assert(!P.lapsed(P.mockRow('free', now), { now: now }), 'a household that never subscribed is not lapsed');
assert(P.isPremium(partner, { now: now }) && partner.covered, 'a partner subscription covers the household');

var justExpired = { status: 'active', expires_at: new Date(now - 1000).toISOString() };
assert(!P.isPremium(justExpired, { now: now, offline: false }), 'an expiry is not Premium online');
assert(P.isPremium(justExpired, { now: now, offline: true }), 'offline grace keeps Premium for 7 days after expiry');
assert(!P.isPremium({ status: 'active', expires_at: new Date(now - P.OFFLINE_GRACE_MS - 1000).toISOString() }, { now: now, offline: true }), 'offline grace ends after 7 days');

assert(P.canAddGoal(2, false) === false && P.canAddGoal(1, false) === true && P.canAddGoal(9, true) === true, 'the third goal needs Premium');
assert(P.goalLocked(2, false) && !P.goalLocked(1, false) && !P.goalLocked(4, true), 'goals past the second are read-only when Premium has ended');
assert(!P.canAddCategory(5, false) && P.canAddCategory(4, false) && P.categoryLocked(5, false) && !P.categoryLocked(5, true), 'the sixth custom category is Premium');
assert(!P.canAddReminder(1, false) && P.canAddReminder(0, false) && P.reminderLocked(1, false), 'the second reminder is Premium');
assert(P.forecastCycles(false) === 1 && P.forecastCycles(true) === 6, 'forward pay cycles are Premium');

var old = new Date(now);
old.setMonth(old.getMonth() - 4);
assert(!P.historyVisible(old, false, now) && P.historyVisible(old, true, now), 'history older than 3 months stays saved and is hidden on the free plan');
var recent = new Date(now);
recent.setMonth(recent.getMonth() - 1);
assert(P.historyVisible(recent, false, now), 'the last 3 months stay visible');

assert(P.blockSecondPurchase(partner, { now: now }), 'a covered household cannot buy a second subscription');
assert(!P.blockSecondPurchase(lapsed, { now: now }), 'a lapsed household can subscribe again');
assert(P.trialAvailable({ trial_used: false }) && !P.trialAvailable({ trial_used: true }), 'one trial per household');
assert(P.paywallKind(partner, { now: now }) === 'covered', 'partner cover replaces the paywall');

var courtesy = P.payerLeft(active, now);
assert(courtesy.status === 'grace' && P.isPremium(courtesy, { now: now }), 'the partner who stays keeps 14 days');
assert(Date.parse(courtesy.expires_at) - now === P.COURTESY_MS, 'the courtesy period is 14 days');
assert(P.accentAllowed('teal', false) && P.accentAllowed('', false) && !P.accentAllowed('plum', false) && P.accentAllowed('plum', true), 'dark mode stays free and extra colours are Premium');

console.log('premium ok');
