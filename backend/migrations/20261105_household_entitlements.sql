-- NOT APPLIED. Do not run this against the production Supabase project.
-- Review it, then run it by hand in the SQL editor when billing is ready.
--
-- One household entitlement. Authenticated members can read it. They cannot
-- write it. The RevenueCat webhook (service role) is the only writer.
-- Family Sharing stays off: one store subscription covers the household here.

create table public.household_entitlements (
  household_id uuid primary key references public.households(id) on delete cascade,
  entitlement text not null default 'premium',
  status text not null check (status in ('trialing','active','grace','billing_retry','expired','revoked')),
  payer_user_id uuid references auth.users(id) on delete set null,
  store text check (store is null or store in ('app_store','play_store','stripe','promo')),
  product_id text,
  expires_at timestamptz,
  trial_used boolean not null default false,
  rc_app_user_id text,
  courtesy_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.household_entitlements enable row level security;

create policy he_select on public.household_entitlements
  for select to authenticated
  using (public.is_active_member(household_id));

revoke all on table public.household_entitlements from public, anon;
grant select on table public.household_entitlements to authenticated;

create or replace function public.household_premium_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(
    (
      select jsonb_build_object(
        'household_id', e.household_id,
        'status', e.status,
        'entitlement', e.entitlement,
        'expires_at', e.expires_at,
        'trial_used', e.trial_used,
        'payer_user_id', e.payer_user_id,
        'store', e.store,
        'product_id', e.product_id,
        'courtesy_until', e.courtesy_until
      )
      from public.household_entitlements e
      where public.is_active_member(e.household_id)
      limit 1
    ),
    jsonb_build_object('status', 'expired', 'trial_used', false)
  );
$fn$;

revoke all on function public.household_premium_status() from public, anon;
grant execute on function public.household_premium_status() to authenticated;

-- When the paying member leaves, Premium follows that person (the webhook
-- moves the row onto their next household). The household they left keeps
-- a 14-day courtesy period. The function lives outside public so clients
-- cannot call it.

create schema if not exists private;

create or replace function private.tg_payer_left()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  ent public.household_entitlements%rowtype;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.status is distinct from 'active' or new.status = 'active' then
    return new;
  end if;
  select * into ent from public.household_entitlements where household_id = new.household_id;
  if not found or ent.payer_user_id is distinct from new.user_id then
    return new;
  end if;
  if ent.status not in ('trialing', 'active', 'grace', 'billing_retry') then
    return new;
  end if;
  update public.household_entitlements
     set status = 'grace',
         courtesy_until = now() + interval '14 days',
         expires_at = now() + interval '14 days',
         updated_at = now()
   where household_id = new.household_id;
  return new;
end
$fn$;

drop trigger if exists payer_left on public.household_members;
create trigger payer_left
  after update of status on public.household_members
  for each row
  execute function private.tg_payer_left();
