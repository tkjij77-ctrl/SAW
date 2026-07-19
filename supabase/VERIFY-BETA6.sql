-- Read-only verification for SAW beta.6 backend hardening.
select
  to_regclass('public.profiles') is not null as profiles_exists,
  to_regclass('public.servers') is not null as servers_exists,
  to_regclass('public.provisioning_jobs') is not null as provisioning_jobs_exists,
  to_regclass('public.api_rate_limits') is not null as rate_limits_exists,
  exists(
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='username_completed'
  ) as username_completed_exists,
  to_regprocedure('public.consume_rate_limit(uuid,text,integer,integer)') is not null as consume_rate_limit_exists,
  to_regprocedure('public.register_server(text,text)') is not null as register_server_exists,
  to_regprocedure('public.grant_server_access(uuid,text,text)') is not null as grant_access_exists,
  to_regprocedure('public.revoke_server_access(uuid,uuid)') is not null as revoke_access_exists;

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name='hf_connections'
  and grantee in ('anon','authenticated','service_role')
order by grantee, privilege_type;

select tablename, rowsecurity
from pg_tables
where schemaname='public'
  and tablename in ('profiles','servers','server_members','audit_logs','hf_connections','provisioning_jobs','api_rate_limits')
order by tablename;
