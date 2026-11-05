# Premium products to create later

Nothing here exists in RevenueCat, App Store Connect, or Google Play yet. Do not create the accounts from this change. Family Sharing stays off. One subscription covers the household.

## RevenueCat

Create a project when you are ready. The public SDK keys go in `window.DUO_PREMIUM_CONFIG` (see `.env.example`). They are blank in git. While they are blank, the app uses the on-device preview and does not call the store.

| | |
| --- | --- |
| Entitlement id | `premium` |
| Offering id | `default` |
| Monthly product | `duo_premium_monthly` — A$4.99, 14-day trial |
| Annual product | `duo_premium_annual` — A$39.99, 14-day trial, the one to feature |
| App user id | The Supabase user id. The app calls `Purchases.configure({ apiKey, appUserID })` after sign-in. |

Attach both products to the `premium` entitlement and put them in the `default` offering, annual first.

Webhook:

```
https://ksrffninlyioqobvdvhu.supabase.co/functions/v1/rc-webhook
```

Authorization header: `Bearer <REVENUECAT_WEBHOOK_SECRET>`.

That function is `backend/functions/rc-webhook/index.ts`. It is not deployed. Its secrets are `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REVENUECAT_WEBHOOK_SECRET`, and optionally `REVENUECAT_REST_API_KEY`. The secret is not the SDK key.

## App Store Connect

- Subscription group: Duo Premium.
- `duo_premium_monthly` — A$4.99, 14-day introductory offer, one per household (the store still counts per Apple ID; `trial_used` on the household row is our check).
- `duo_premium_annual` — A$39.99, same trial.
- Family Sharing: off.
- Paid Applications agreement, tax, and banking before review.

## Google Play

- Same product ids, same prices, 14-day trial.
- One trial per household is also enforced by `trial_used`, because Play counts trials per Google account.
- Billing grace period on, so `BILLING_ISSUE` can map to `grace`.

## Supabase, not applied

- `backend/migrations/20261105_household_entitlements.sql` — the row, RLS read for members, no client writes, `household_premium_status()`, and a 14-day courtesy when the payer leaves.
- Deploy `rc-webhook` only after the migration and the webhook secret exist.

Stripe is not a product yet. `DuoPremium.webCheckout()` returns `{ later: true }` and the paywall does not link to a web price.
