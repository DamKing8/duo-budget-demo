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

  foreach grants in array array[
    'spend_entries_sync_idx','spend_entries_day_idx','spend_entries_item_idx',
    'spend_entries_budget_item_fk_idx','spend_entries_owner_member_fk_idx','spend_entries_paid_by_member_fk_idx'
  ]
  loop
    if to_regclass('public.' || grants) is null then
      raise exception 'missing index %', grants;
    end if;
  end loop;

  if (select string_agg(a.attname, ',' order by u.ord)
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join lateral unnest(i.indkey::smallint[]) with ordinality as u(attnum, ord) on true
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
      where c.relname = 'spend_entries_budget_item_fk_idx' and i.indpred is null and i.indisvalid
     ) is distinct from 'budget_item_id,household_id' then
    raise exception 'spend_entries_budget_item_fk_idx does not cover (budget_item_id, household_id)';
  end if;
  if (select string_agg(a.attname, ',' order by u.ord)
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join lateral unnest(i.indkey::smallint[]) with ordinality as u(attnum, ord) on true
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
      where c.relname = 'spend_entries_owner_member_fk_idx' and i.indpred is null and i.indisvalid
     ) is distinct from 'owner_member_id,household_id' then
    raise exception 'spend_entries_owner_member_fk_idx does not cover (owner_member_id, household_id)';
  end if;
  if (select string_agg(a.attname, ',' order by u.ord)
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join lateral unnest(i.indkey::smallint[]) with ordinality as u(attnum, ord) on true
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
      where c.relname = 'spend_entries_paid_by_member_fk_idx' and i.indpred is null and i.indisvalid
     ) is distinct from 'paid_by_member_id,household_id' then
    raise exception 'spend_entries_paid_by_member_fk_idx does not cover (paid_by_member_id, household_id)';
  end if;

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
  where ns.nspname = 'public' and p.proname = 'delete_my_data' and p.prosecdef
    and exists (select 1 from unnest(p.proconfig) cfg where cfg in ('search_path=', 'search_path=""'))
    and p.prosrc like '%duo.skip_stamp%'
    and p.prosrc !~* 'disable[[:space:]]+trigger'
    and p.prosrc !~* 'enable[[:space:]]+trigger'
    and p.prosrc !~* 'alter[[:space:]]+table';
  if n <> 1 then
    raise exception 'delete_my_data must be security definer, pin search_path, set duo.skip_stamp, and not alter triggers';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = 'tg_sync_row'
      and exists (select 1 from unnest(p.proconfig) cfg where cfg in ('search_path=', 'search_path=""'))
      and p.prosrc like '%duo.skip_stamp%'
      and position('new.updated_by := auth.uid();' in p.prosrc) > 0
  ) then
    raise exception 'tg_sync_row must keep the normal stamp and honour duo.skip_stamp';
  end if;

  if not has_function_privilege('authenticated', 'public.delete_my_data()', 'execute') then
    raise exception 'authenticated cannot execute delete_my_data';
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
