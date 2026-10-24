-- Duo Budget: manual spending entries.
-- NOT APPLIED. Review, then run in the Supabase SQL editor. Do not apply from CI or from the app.
--
-- Deviation from the draft check (amount <> 0): a personal entry is zeroed in the same
-- update that sets deleted_at, so amount 0 is allowed only on a soft-deleted row.

alter table public.budget_items
  add constraint budget_items_id_household_key unique (id, household_id);

create table if not exists public.spend_entries (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  budget_item_id     uuid,
  line_name          text not null default '' check (char_length(line_name) <= 120),
  category           text not null check (category in ('expenses','personal','savings')),
  owner_member_id    uuid,
  paid_by_member_id  uuid,
  amount             numeric(12,2) not null,
  spent_on           date not null,
  note               text not null default '' check (char_length(note) <= 120),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  server_updated_at  timestamptz not null default now(),
  updated_by         uuid,
  deleted_at         timestamptz,
  constraint spend_entries_amount_check check (
    amount between -100000 and 100000
    and (amount <> 0 or deleted_at is not null)
  ),
  foreign key (budget_item_id, household_id)    references public.budget_items(id, household_id),
  foreign key (owner_member_id, household_id)   references public.household_members(id, household_id),
  foreign key (paid_by_member_id, household_id) references public.household_members(id, household_id)
);

create index if not exists spend_entries_sync_idx on public.spend_entries (household_id, server_updated_at);
create index if not exists spend_entries_day_idx  on public.spend_entries (household_id, spent_on) where deleted_at is null;
create index if not exists spend_entries_item_idx on public.spend_entries (budget_item_id) where budget_item_id is not null;

drop trigger if exists sync_row on public.spend_entries;
create trigger sync_row before insert or update on public.spend_entries
  for each row execute function public.tg_sync_row();

alter table public.spend_entries enable row level security;
drop policy if exists spend_entries_select on public.spend_entries;
create policy spend_entries_select on public.spend_entries for select to authenticated
  using (public.is_active_member(household_id));
drop policy if exists spend_entries_insert on public.spend_entries;
create policy spend_entries_insert on public.spend_entries for insert to authenticated
  with check (public.is_active_member(household_id));
drop policy if exists spend_entries_update on public.spend_entries;
create policy spend_entries_update on public.spend_entries for update to authenticated
  using (public.is_active_member(household_id)) with check (public.is_active_member(household_id));

-- Postgres grants new tables to PUBLIC. The live project also has a service_role.
-- Neither may read or write spending. Authenticated gets select, insert and update only.
revoke all on table public.spend_entries from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on table public.spend_entries from service_role';
  end if;
end $$;
grant select, insert, update on table public.spend_entries to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.spend_entries;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- Account deletion. This function is not on the live database yet.
-- Shared household: soft-delete the leaver's personal spending (note blank, amount zero),
-- unlink them from shared spending, and scrub updated_by. Sole member: soft-delete the household.
create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  mem record;
  shared boolean;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  for mem in
    select m.id, m.household_id
    from public.household_members m
    where m.user_id = uid and m.deleted_at is null and m.status = 'active'
  loop
    shared := exists (
      select 1 from public.household_members o
      where o.household_id = mem.household_id
        and o.id <> mem.id
        and o.status = 'active'
        and o.deleted_at is null
    );

    if shared then
      update public.spend_entries
         set deleted_at = now(), note = '', amount = 0, updated_at = now()
       where household_id = mem.household_id
         and owner_member_id = mem.id
         and deleted_at is null;

      update public.spend_entries
         set paid_by_member_id = null, note = '', updated_at = now()
       where household_id = mem.household_id
         and owner_member_id is null
         and paid_by_member_id = mem.id
         and deleted_at is null;

      update public.budget_items
         set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id
         and owner_member_id = mem.id
         and deleted_at is null;

      update public.goals
         set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id
         and owner_member_id = mem.id
         and deleted_at is null;

      update public.pay_cycles
         set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id
         and member_id = mem.id
         and deleted_at is null;

      update public.goal_contributions
         set member_id = null, note = '', updated_at = now()
       where household_id = mem.household_id
         and member_id = mem.id
         and deleted_at is null;

      update public.invites
         set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id
         and deleted_at is null
         and (created_by = uid or used_by = uid);

      update public.household_members
         set status = 'left', left_at = now(), deleted_at = now(), updated_at = now()
       where id = mem.id;
    else
      update public.spend_entries set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id and deleted_at is null;
      update public.budget_items set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id and deleted_at is null;
      update public.goals set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id and deleted_at is null;
      update public.pay_cycles set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id and deleted_at is null;
      update public.goal_contributions set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id and deleted_at is null;
      update public.invites set deleted_at = now(), updated_at = now()
       where household_id = mem.household_id and deleted_at is null;
      update public.household_members
         set status = 'left', left_at = coalesce(left_at, now()), deleted_at = coalesce(deleted_at, now()), updated_at = now()
       where household_id = mem.household_id and status = 'active';
      update public.households
         set deleted_at = now(), updated_at = now()
       where id = mem.household_id and deleted_at is null;
    end if;
  end loop;

  -- The sync trigger stamps updated_by from auth.uid(). Disable it only for the scrub.
  begin
    alter table public.spend_entries disable trigger sync_row;
    alter table public.budget_items disable trigger sync_row;
    alter table public.goals disable trigger sync_row;
    alter table public.pay_cycles disable trigger sync_row;
    alter table public.goal_contributions disable trigger sync_row;
    alter table public.household_members disable trigger sync_row;
    alter table public.households disable trigger sync_row;
    alter table public.invites disable trigger sync_row;

    update public.spend_entries set updated_by = null where updated_by = uid;
    update public.budget_items set updated_by = null where updated_by = uid;
    update public.goals set updated_by = null where updated_by = uid;
    update public.pay_cycles set updated_by = null where updated_by = uid;
    update public.goal_contributions set updated_by = null where updated_by = uid;
    update public.household_members set updated_by = null where updated_by = uid;
    update public.households set updated_by = null where updated_by = uid;
    update public.invites set updated_by = null where updated_by = uid;

    alter table public.spend_entries enable trigger sync_row;
    alter table public.budget_items enable trigger sync_row;
    alter table public.goals enable trigger sync_row;
    alter table public.pay_cycles enable trigger sync_row;
    alter table public.goal_contributions enable trigger sync_row;
    alter table public.household_members enable trigger sync_row;
    alter table public.households enable trigger sync_row;
    alter table public.invites enable trigger sync_row;
  exception when others then
    begin
      alter table public.spend_entries enable trigger sync_row;
      alter table public.budget_items enable trigger sync_row;
      alter table public.goals enable trigger sync_row;
      alter table public.pay_cycles enable trigger sync_row;
      alter table public.goal_contributions enable trigger sync_row;
      alter table public.household_members enable trigger sync_row;
      alter table public.households enable trigger sync_row;
      alter table public.invites enable trigger sync_row;
    exception when others then null;
    end;
    raise;
  end;
end
$fn$;

revoke all on function public.delete_my_data() from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public.delete_my_data() from service_role';
  end if;
end $$;
grant execute on function public.delete_my_data() to authenticated;
