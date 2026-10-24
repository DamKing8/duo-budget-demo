-- Checks the spend_entries migration. Raises if a required piece is missing.
-- Safe to run read-only aside from the exception it throws on failure.
do $verify$
declare
  n int;
  grants text;
begin
  if to_regclass('public.spend_entries') is null then
    raise exception 'spend_entries table is missing';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relname = 'spend_entries' and c.relrowsecurity
  ) then
    raise exception 'RLS is off on spend_entries';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'spend_entries'
        and policyname in ('spend_entries_select','spend_entries_insert','spend_entries_update')) <> 3 then
    raise exception 'spend_entries is missing select, insert or update policy';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'spend_entries' and cmd = 'DELETE'
  ) then
    raise exception 'spend_entries must not have a delete policy';
  end if;

  select string_agg(grantee || ' ' || privilege_type, ', ' order by grantee, privilege_type)
    into grants
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'spend_entries'
    and grantee in ('anon','authenticated','service_role','PUBLIC');

  if grants is distinct from 'authenticated INSERT, authenticated SELECT, authenticated UPDATE' then
    raise exception 'spend_entries grants are %, expected authenticated select/insert/update only', coalesce(grants, '(none)');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'budget_items_id_household_key' and conrelid = 'public.budget_items'::regclass
  ) then
    raise exception 'budget_items unique (id, household_id) is missing';
  end if;

  foreach grants in array array['spend_entries_sync_idx','spend_entries_day_idx','spend_entries_item_idx']
  loop
    if to_regclass('public.' || grants) is null then
      raise exception 'missing index %', grants;
    end if;
  end loop;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'sync_row' and tgrelid = 'public.spend_entries'::regclass and not tgisinternal
  ) then
    raise exception 'sync_row trigger missing on spend_entries';
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
      where p.pubname = 'supabase_realtime' and c.relname = 'spend_entries'
    ) then
      raise exception 'spend_entries is not in supabase_realtime';
    end if;
  end if;

  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'delete_my_data' and p.prosecdef;
  if n <> 1 then
    raise exception 'delete_my_data is missing or is not security definer';
  end if;

  if exists (
    select 1 from information_schema.routine_privileges
    where specific_schema = 'public' and routine_name = 'delete_my_data'
      and grantee in ('anon','PUBLIC','public') and privilege_type = 'EXECUTE'
  ) then
    raise exception 'delete_my_data is still executable by anon or public';
  end if;
end
$verify$;
