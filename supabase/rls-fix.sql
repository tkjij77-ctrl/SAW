-- Fix: new row violates row-level security policy for table "servers"
-- Run once in Supabase SQL Editor as role postgres.
create or replace function public.register_server(p_name text,p_hf_space_id text)
returns public.servers language plpgsql security definer set search_path=public as $$
declare result public.servers;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from profiles where id=auth.uid()) then raise exception 'Site profile not found'; end if;
  insert into servers(owner_id,name,hf_space_id)
  values(auth.uid(),trim(p_name),trim(p_hf_space_id))
  on conflict(owner_id,hf_space_id)
  do update set name=excluded.name,updated_at=now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.register_server(text,text) from public;
grant execute on function public.register_server(text,text) to authenticated;

-- Force Supabase/PostgREST to discover the new RPC immediately.
notify pgrst, 'reload schema';

-- Verification: should return one row with both argument names.
select p.proname, p.proargnames
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='register_server';
