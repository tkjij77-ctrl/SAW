-- SAW MC Hosting v2.0.0-beta.6 backend hardening
-- Safe to run more than once after schema.sql, provisioning-migration.sql and social-auth-migration.sql.

begin;

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists username_completed boolean not null default true;

-- Keep updated_at trustworthy and consistent.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists servers_set_updated_at on public.servers;
create trigger servers_set_updated_at before update on public.servers
for each row execute function public.set_updated_at();

drop trigger if exists provisioning_jobs_set_updated_at on public.provisioning_jobs;
create trigger provisioning_jobs_set_updated_at before update on public.provisioning_jobs
for each row execute function public.set_updated_at();

-- Common authorization lookups.
create index if not exists servers_owner_created_idx
  on public.servers(owner_id, created_at desc);
create index if not exists server_members_user_idx
  on public.server_members(user_id, server_id);
create index if not exists audit_logs_server_created_idx
  on public.audit_logs(server_id, created_at desc);

-- Keep the newest active attempt if an older beta left duplicate jobs.
with ranked_jobs as (
  select id, row_number() over (
    partition by user_id, space_repo_id order by created_at desc, id desc
  ) as position
  from public.provisioning_jobs
  where state not in ('failed', 'cancelled', 'running')
)
update public.provisioning_jobs
set state='cancelled', step='cancelled', error_code='SUPERSEDED',
    error_message='Superseded by a newer provisioning attempt'
where id in (select id from ranked_jobs where position > 1);

create unique index if not exists provisioning_jobs_one_active_space_idx
  on public.provisioning_jobs(user_id, space_repo_id)
  where state not in ('failed', 'cancelled', 'running');

-- Atomic, server-side request throttling. No browser role can inspect or mutate this table.
create table if not exists public.api_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null check (bucket ~ '^[a-z0-9_.:-]{1,80}$'),
  window_start timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  primary key(user_id, bucket, window_start)
);

alter table public.api_rate_limits enable row level security;
revoke all on table public.api_rate_limits from anon, authenticated;
grant all on table public.api_rate_limits to service_role;

create or replace function public.consume_rate_limit(
  p_user uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window timestamptz;
  current_count integer;
begin
  if p_user is null
     or p_bucket !~ '^[a-z0-9_.:-]{1,80}$'
     or p_limit not between 1 and 10000
     or p_window_seconds not between 1 and 86400 then
    raise exception 'Invalid rate limit parameters';
  end if;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits(user_id, bucket, window_start, request_count)
  values(p_user, p_bucket, current_window, 1)
  on conflict(user_id, bucket, window_start)
  do update set request_count = public.api_rate_limits.request_count + 1
  returning request_count into current_count;

  -- Small opportunistic cleanup keeps the free database compact.
  if random() < 0.02 then
    delete from public.api_rate_limits where window_start < now() - interval '2 days';
  end if;

  return current_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(uuid,text,integer,integer) from public;
grant execute on function public.consume_rate_limit(uuid,text,integer,integer) to service_role;

-- Prevent browsers from reading or writing connection secrets even if default grants change.
alter table public.hf_connections enable row level security;
revoke all on table public.hf_connections from anon, authenticated;
grant all on table public.hf_connections to service_role;

-- Provisioning writes remain backend-only.
alter table public.provisioning_jobs enable row level security;
revoke insert, update, delete on public.provisioning_jobs from anon, authenticated;
grant select on public.provisioning_jobs to authenticated;
grant all on public.provisioning_jobs to service_role;

-- Authorization helpers always use the JWT identity. The legacy p_user argument is
-- retained for compatibility but deliberately ignored to prevent identity probing.
create or replace function public.can_view_server(p_server uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists(select 1 from servers s where s.id=p_server and s.owner_id=auth.uid())
    or exists(select 1 from server_members m where m.server_id=p_server and m.user_id=auth.uid())
  );
$$;

create or replace function public.is_server_owner(p_server uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists(
    select 1 from servers s where s.id=p_server and s.owner_id=auth.uid()
  );
$$;

create or replace function public.member_role(p_server uuid, p_user uuid default auth.uid())
returns text language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then null
    when exists(select 1 from servers s where s.id=p_server and s.owner_id=auth.uid()) then 'owner'
    else (select role from server_members where server_id=p_server and user_id=auth.uid())
  end;
$$;

revoke all on function public.can_view_server(uuid,uuid) from public, anon;
revoke all on function public.is_server_owner(uuid,uuid) from public, anon;
revoke all on function public.member_role(uuid,uuid) from public, anon;
grant execute on function public.can_view_server(uuid,uuid) to authenticated;
grant execute on function public.is_server_owner(uuid,uuid) to authenticated;
grant execute on function public.member_role(uuid,uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
