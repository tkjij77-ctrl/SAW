-- Read-only verification for SAW v2.0.0-beta.14
select
  to_regclass('public.servers') is not null as servers_exists,
  to_regclass('public.provisioning_jobs') is not null as provisioning_jobs_exists,
  to_regclass('public.api_rate_limits') is not null as rate_limits_exists,
  to_regprocedure('public.consume_rate_limit(uuid,text,integer,integer)') is not null as rate_limit_function_exists,
  to_regprocedure('public.prune_audit_logs()') is not null as audit_retention_function_exists,
  exists(select 1 from pg_trigger where tgname='audit_logs_retention' and not tgisinternal) as audit_retention_trigger_exists,
  exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='users read related profiles') as private_profile_policy_exists,
  not exists(select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='authenticated can read profiles') as public_profile_policy_removed;

select tablename, rowsecurity
from pg_tables
where schemaname='public'
  and tablename in ('profiles','servers','server_members','audit_logs','hf_connections','provisioning_jobs','api_rate_limits')
order by tablename;

-- Expected: service_role only. anon/authenticated must not appear.
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name='hf_connections'
  and grantee in ('anon','authenticated','service_role')
order by grantee, privilege_type;

select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='terms_version') as terms_version_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='terms_accepted_at') as terms_accepted_at_exists;
