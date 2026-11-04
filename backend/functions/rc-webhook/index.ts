// NOT DEPLOYED. Do not run `supabase functions deploy` from this change.
//
// RevenueCat webhook → household_entitlements.
// The client never writes this table. Stripe is not handled here; RevenueCat
// can forward Stripe later into the same events.
//
// Dashboard setup (later, when the RevenueCat project exists):
//   URL: https://ksrffninlyioqobvdvhu.supabase.co/functions/v1/rc-webhook
//   Authorization header: Bearer <REVENUECAT_WEBHOOK_SECRET>
//
// Function secrets, never committed:
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   REVENUECAT_WEBHOOK_SECRET
//   REVENUECAT_REST_API_KEY   optional; when set, the function re-fetches the subscriber
//
// Family Sharing stays off. One subscription covers the household row.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const LIVE = new Set(['trialing', 'active', 'grace', 'billing_retry']);

function statusFor(eventType: string): string {
  if (eventType === 'INITIAL_PURCHASE' || eventType === 'RENEWAL' || eventType === 'UNCANCELLATION' || eventType === 'PRODUCT_CHANGE' || eventType === 'NON_RENEWING_PURCHASE') return 'active';
  if (eventType === 'BILLING_ISSUE') return 'grace';
  if (eventType === 'CANCELLATION') return 'revoked';
  if (eventType === 'EXPIRATION') return 'expired';
  return 'active';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') || '';
  const header = req.headers.get('Authorization') || '';
  if (!secret || header !== 'Bearer ' + secret) return new Response('Unauthorized', { status: 401 });

  const url = Deno.env.get('SUPABASE_URL') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !service) return Response.json({ error: 'Webhook is not configured.' }, { status: 500 });

  const body = await req.json();
  const event = body.event || body;
  const appUserId = String(event.app_user_id || event.original_app_user_id || '');
  if (!appUserId) return Response.json({ error: 'Missing app user.' }, { status: 400 });

  const admin = createClient(url, service);
  const { data: member, error: memberError } = await admin
    .from('household_members')
    .select('household_id, user_id')
    .eq('user_id', appUserId)
    .eq('status', 'active')
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (memberError) return Response.json({ error: memberError.message }, { status: 500 });
  if (!member) return Response.json({ ok: true, ignored: 'no-household' });

  const type = String(event.type || '');
  if (type === 'TRANSFER') {
    const fromId = String((event.transferred_from && event.transferred_from[0]) || '');
    const toId = String((event.transferred_to && event.transferred_to[0]) || appUserId);
    const { data: dest } = await admin
      .from('household_members')
      .select('household_id')
      .eq('user_id', toId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();
    if (!dest) return Response.json({ ok: true, ignored: 'transfer-without-household' });
    await admin.from('household_entitlements').delete().eq('household_id', member.household_id).eq('payer_user_id', fromId);
    await admin.from('household_entitlements').upsert({
      household_id: dest.household_id,
      entitlement: 'premium',
      status: 'active',
      payer_user_id: toId,
      rc_app_user_id: toId,
      store: event.store || null,
      product_id: event.product_id || null,
      expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
      trial_used: true,
      updated_at: new Date().toISOString()
    });
    return Response.json({ ok: true, transfer: true });
  }

  const status = statusFor(type);
  const row = {
    household_id: member.household_id,
    entitlement: 'premium',
    status: status,
    payer_user_id: appUserId,
    rc_app_user_id: appUserId,
    store: event.store === 'APP_STORE' ? 'app_store' : event.store === 'PLAY_STORE' ? 'play_store' : event.store === 'STRIPE' ? 'stripe' : event.store ? String(event.store).toLowerCase() : null,
    product_id: event.product_id || null,
    expires_at: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
    trial_used: true,
    updated_at: new Date().toISOString()
  };
  if (!LIVE.has(status) && type !== 'EXPIRATION' && type !== 'CANCELLATION') {
    row.status = status;
  }
  const { error } = await admin.from('household_entitlements').upsert(row);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
});
