-- Not applied to the hosted project. The repo does not include an RLS policy that
-- lets a member change households.name or their household_members.display_name.
-- Run this in the Supabase SQL editor when a rename from the app is rejected.
-- It adds one function. It does not change tables.

create or replace function public.rename_my_household(p_name text, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
  mem public.household_members%rowtype;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_display_name is null or char_length(btrim(p_display_name)) < 1 or char_length(btrim(p_display_name)) > 60 then
    raise exception 'display name must be 1 to 60 characters';
  end if;
  if p_name is null or char_length(btrim(p_name)) < 1 or char_length(btrim(p_name)) > 80 then
    raise exception 'household name must be 1 to 80 characters';
  end if;
  select * into mem
    from public.household_members
   where user_id = uid and status = 'active' and deleted_at is null
   order by joined_at
   limit 1;
  if mem.id is null then
    raise exception 'no household' using errcode = '42501';
  end if;
  update public.household_members
     set display_name = btrim(p_display_name), updated_at = now()
   where id = mem.id;
  if mem.joined_at = (
       select min(m.joined_at) from public.household_members m
        where m.household_id = mem.household_id and m.status = 'active' and m.deleted_at is null
     )
     or exists (
       select 1 from public.households h
        where h.id = mem.household_id and h.created_by = uid and h.deleted_at is null
     ) then
    update public.households
       set name = btrim(p_name), updated_at = now()
     where id = mem.household_id and deleted_at is null;
  end if;
end
$fn$;

revoke all on function public.rename_my_household(text, text) from public, anon;
grant execute on function public.rename_my_household(text, text) to authenticated;
