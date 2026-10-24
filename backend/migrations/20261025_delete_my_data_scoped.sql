-- Clear updated_by inside delete_my_data without turning sync triggers off.
-- Do not apply from CI or from the app. Review, then run in the Supabase SQL editor.
--
-- 20261024_spend_entries.sql is already applied. This file only replaces functions.
-- It does not drop tables or columns and it does not change stored rows.
-- Running it again replaces the same two functions and repeats the same grants.
--
-- sync_row used to be disabled on eight tables while updated_by was cleared. That
-- takes a table lock, and any other session's write in that window skips the
-- server timestamp. The trigger now leaves updated_by null only when this
-- transaction has set duo.skip_stamp and the statement is clearing the caller's
-- own updated_by without changing anything else. The setting is transaction-local,
-- so other sessions keep the normal stamp.

create or replace function public.tg_sync_row()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if coalesce(current_setting('duo.skip_stamp', true), '') = 'on'
     and tg_op = 'UPDATE'
     and new.updated_by is null
     and old.updated_by is not distinct from auth.uid()
     and (to_jsonb(new) - 'updated_by') = (to_jsonb(old) - 'updated_by')
  then
    return new;
  end if;
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

  -- Stamp stays on for every other session. This setting lasts only for this transaction.
  perform set_config('duo.skip_stamp', 'on', true);
  begin
    update public.spend_entries set updated_by = null where updated_by = uid;
    update public.budget_items set updated_by = null where updated_by = uid;
    update public.goals set updated_by = null where updated_by = uid;
    update public.pay_cycles set updated_by = null where updated_by = uid;
    update public.goal_contributions set updated_by = null where updated_by = uid;
    update public.household_members set updated_by = null where updated_by = uid;
    update public.households set updated_by = null where updated_by = uid;
    update public.invites set updated_by = null where updated_by = uid;
    perform set_config('duo.skip_stamp', 'off', true);
  exception when others then
    perform set_config('duo.skip_stamp', 'off', true);
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
