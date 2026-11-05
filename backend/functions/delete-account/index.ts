// NOT DEPLOYED. Do not run `supabase functions deploy` from this change.
// Source for the App Store account-deletion function. The app calls it first.
// If it is not on the project, the app calls public.delete_my_account() and
// then public.delete_my_data(). Neither of those revokes an Apple refresh token.
//
// Secrets (set in the function env, never in the app):
//   SUPABASE_URL
//   SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY
//   APPLE_CLIENT_ID          Services ID, only once Sign in with Apple exists
//   APPLE_CLIENT_SECRET      JWT client secret, only once that key exists
//
// Apple's revoke endpoint is skipped when APPLE_CLIENT_SECRET is empty.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const authHeader = req.headers.get('Authorization') || '';
  if (!url || !anon || !service || !authHeader) {
    return Response.json({ error: 'Account deletion is not configured on the server.' }, { status: 500 });
  }

  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return Response.json({ error: 'Not signed in.' }, { status: 401 });
  const user = userData.user;

  const { error: dataError } = await userClient.rpc('delete_my_data');
  if (dataError) return Response.json({ error: dataError.message }, { status: 400 });

  const apple = (user.identities || []).find((id) => id.provider === 'apple');
  const appleSecret = Deno.env.get('APPLE_CLIENT_SECRET') || '';
  const appleClient = Deno.env.get('APPLE_CLIENT_ID') || '';
  if (apple && appleSecret && appleClient) {
    const token = apple.identity_data && (apple.identity_data.refresh_token || apple.identity_data.access_token);
    if (token) {
      await fetch('https://appleid.apple.com/auth/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: appleClient, client_secret: appleSecret, token: String(token), token_type_hint: 'refresh_token' })
      });
    }
  }

  const admin = createClient(url, service);
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) return Response.json({ error: deleteError.message }, { status: 500 });
  return Response.json({ ok: true });
});
