-- NOT APPLIED. Do not run this against the production Supabase project from the app or from CI.
-- Review it, then run it by hand in the SQL editor when you are ready.
--
-- public.delete_my_data() is already applied. It removes household rows and does not
-- delete the sign-in user. This adds public.delete_my_account(), which runs that
-- function and then deletes auth.users for the signed-in person.
-- Until this is applied, the app falls back to delete_my_data() and says so.
-- Apple token revocation is not possible from SQL. That lives in the undeployed
-- delete-account Edge Function.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform public.delete_my_data();
  delete from auth.users where id = uid;
end
$fn$;

revoke all on function public.delete_my_account() from public, anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public.delete_my_account() from service_role';
  end if;
end $$;
grant execute on function public.delete_my_account() to authenticated;
