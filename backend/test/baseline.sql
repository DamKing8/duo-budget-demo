-- Local stand-in for the live Duo Budget schema, before spend_entries.
-- Used only by backend/test. Not applied to the hosted project.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

grant usage on schema public to authenticated;

create or replace function public.tg_sync_row()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.created_at <> old.created_at then
      raise exception 'id/created_at are immutable' using errcode = '42501';
    end if;
    if tg_table_name <> 'households' and (to_jsonb(new)->>'household_id') <> (to_jsonb(old)->>'household_id') then
      raise exception 'household_id is immutable' using errcode = '42501';
    end if;
    if new.updated_at < old.updated_at then
      return null;
    end if;
  end if;
  if new.updated_at is null or new.updated_at > now() + interval '5 minutes' then
    new.updated_at := now();
  end if;
  new.server_updated_at := clock_timestamp();
  new.updated_by := auth.uid();
  return new;
end
$fn$;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  currency text not null default 'AUD' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  status text not null default 'active' check (status in ('active','left','removed')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (id, household_id),
  check ((status = 'active') = (left_at is null))
);

create table public.budget_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  amount numeric(12,2) not null check (amount >= 0),
  freq text not null check (freq in ('week','fortnight','month','year')),
  category text not null check (category in ('income','savings','personal','expenses')),
  tag text not null default '' check (char_length(tag) <= 40),
  owner_member_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  foreign key (owner_member_id, household_id) references public.household_members(id, household_id)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  emoji text not null default '' check (char_length(emoji) <= 16),
  target numeric(12,2) not null check (target > 0),
  saved numeric(12,2) not null default 0 check (saved >= 0),
  per_fortnight numeric(12,2) not null default 0 check (per_fortnight >= 0),
  target_date date,
  owner_member_id uuid,
  split text not null default 'even' check (split in ('even','income','custom')),
  custom_split jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  unique (id, household_id),
  foreign key (owner_member_id, household_id) references public.household_members(id, household_id)
);

create table public.pay_cycles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null,
  cycle text not null check (cycle in ('week','fortnight','month')),
  next_pay_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  foreign key (member_id, household_id) references public.household_members(id, household_id) on delete cascade
);

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  goal_id uuid not null,
  member_id uuid,
  amount numeric(12,2) not null check (amount <> 0),
  contributed_on date not null default current_date,
  note text not null default '' check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  foreign key (goal_id, household_id) references public.goals(id, household_id) on delete cascade,
  foreign key (member_id, household_id) references public.household_members(id, household_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code text not null,
  created_by uuid references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  used_by uuid,
  revoked_at timestamptz,
  seat_member_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz
);

create trigger sync_row before insert or update on public.households
  for each row execute function public.tg_sync_row();
create trigger sync_row before insert or update on public.household_members
  for each row execute function public.tg_sync_row();
create trigger sync_row before insert or update on public.budget_items
  for each row execute function public.tg_sync_row();
create trigger sync_row before insert or update on public.goals
  for each row execute function public.tg_sync_row();
create trigger sync_row before insert or update on public.pay_cycles
  for each row execute function public.tg_sync_row();
create trigger sync_row before insert or update on public.goal_contributions
  for each row execute function public.tg_sync_row();
create trigger sync_row before insert or update on public.invites
  for each row execute function public.tg_sync_row();

create or replace function public.is_active_member(hh uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.household_members m
    join public.households h on h.id = m.household_id and h.deleted_at is null
    where m.household_id = hh and m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null)
$fn$;

drop publication if exists supabase_realtime;
create publication supabase_realtime;
