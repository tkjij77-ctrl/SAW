-- SAW MC Hosting v2.0.0-beta.15 complete database upgrade
-- Run in Supabase SQL Editor. Safe to run again.


-- ============================================================================
-- BASE SCHEMA
-- ============================================================================
-- MC Control Cloud multi-user schema
-- Run once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;
-- Sensitive connection rows live in public schema only so Edge Functions can
-- reach them through PostgREST. RLS has no client policy, so browser users see zero rows.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username = lower(username) and username ~ '^[a-z0-9_.-]{3,32}$'),
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.servers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  hf_space_id text not null check (hf_space_id ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, hf_space_id)
);

create table if not exists public.server_members (
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin','operator','editor','viewer')),
  added_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key(server_id, user_id)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Tokens are never exposed by the Data API. Only Edge Functions with service role use this schema.
create table if not exists public.hf_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hf_username text not null,
  access_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.servers enable row level security;
alter table public.server_members enable row level security;
alter table public.audit_logs enable row level security;
alter table public.hf_connections enable row level security;
revoke all on table public.hf_connections from anon, authenticated;
grant all on table public.hf_connections to service_role;

-- Profiles: signed-in users may resolve an exact username; users edit only themselves.
drop policy if exists "authenticated can read profiles" on public.profiles;
create policy "authenticated can read profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Avoid recursive member RLS by using security-definer helpers.
create or replace function public.can_view_server(p_server uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from servers s where s.id=p_server and s.owner_id=p_user)
      or exists(select 1 from server_members m where m.server_id=p_server and m.user_id=p_user);
$$;
revoke all on function public.can_view_server(uuid,uuid) from public;
grant execute on function public.can_view_server(uuid,uuid) to authenticated;

create or replace function public.is_server_owner(p_server uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from servers s where s.id=p_server and s.owner_id=p_user);
$$;
revoke all on function public.is_server_owner(uuid,uuid) from public;
grant execute on function public.is_server_owner(uuid,uuid) to authenticated;

create or replace function public.member_role(p_server uuid, p_user uuid default auth.uid())
returns text language sql stable security definer set search_path = public as $$
  select case when exists(select 1 from servers s where s.id=p_server and s.owner_id=p_user) then 'owner'
    else (select role from server_members where server_id=p_server and user_id=p_user) end;
$$;
revoke all on function public.member_role(uuid,uuid) from public;
grant execute on function public.member_role(uuid,uuid) to authenticated;

drop policy if exists "members can read servers" on public.servers;
create policy "members can read servers" on public.servers for select to authenticated using (public.can_view_server(id));
drop policy if exists "owners insert servers" on public.servers;
create policy "owners insert servers" on public.servers for insert to authenticated with check (owner_id=auth.uid());
drop policy if exists "owners update servers" on public.servers;
create policy "owners update servers" on public.servers for update to authenticated using (owner_id=auth.uid()) with check (owner_id=auth.uid());
drop policy if exists "owners delete servers" on public.servers;
create policy "owners delete servers" on public.servers for delete to authenticated using (owner_id=auth.uid());

drop policy if exists "members can read memberships" on public.server_members;
create policy "members can read memberships" on public.server_members for select to authenticated using (public.can_view_server(server_id));
drop policy if exists "owners manage memberships" on public.server_members;
create policy "owners manage memberships" on public.server_members for all to authenticated using (public.is_server_owner(server_id)) with check (public.is_server_owner(server_id));

drop policy if exists "members read audit" on public.audit_logs;
create policy "members read audit" on public.audit_logs for select to authenticated using (public.can_view_server(server_id));

-- Create the public profile automatically after registration.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
declare requested text;
begin
  requested := lower(coalesce(new.raw_user_meta_data->>'username',''));
  if requested !~ '^[a-z0-9_.-]{3,32}$' then
    raise exception 'Invalid username';
  end if;
  insert into public.profiles(id,username,display_name)
  values(new.id,requested,coalesce(new.raw_user_meta_data->>'display_name',requested));
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Register or update a Space owned by the signed-in site user.
-- owner_id is derived from auth.uid() server-side, avoiding client/RLS mismatches.
create or replace function public.register_server(
  p_name text,
  p_hf_space_id text
)
returns public.servers
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.servers;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if not exists(select 1 from profiles where id=auth.uid()) then
    raise exception 'Site profile not found';
  end if;
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
notify pgrst, 'reload schema';

-- Owner grants/replaces access by exact site username.
create or replace function public.grant_server_access(p_server uuid, p_username text, p_role text)
returns void language plpgsql security definer set search_path=public as $$
declare target_id uuid;
begin
  if not public.is_server_owner(p_server,auth.uid()) then raise exception 'Owner permission required'; end if;
  if p_role not in ('admin','operator','editor','viewer') then raise exception 'Invalid role'; end if;
  select id into target_id from profiles where username=lower(trim(p_username));
  if target_id is null then raise exception 'User not found'; end if;
  if target_id=auth.uid() then raise exception 'Owner already has full access'; end if;
  insert into server_members(server_id,user_id,role,added_by)
  values(p_server,target_id,p_role,auth.uid())
  on conflict(server_id,user_id) do update set role=excluded.role,added_by=auth.uid();
  insert into audit_logs(server_id,user_id,action,details)
  values(p_server,auth.uid(),'member.grant',jsonb_build_object('target',p_username,'role',p_role));
end;
$$;
revoke all on function public.grant_server_access(uuid,text,text) from public;
grant execute on function public.grant_server_access(uuid,text,text) to authenticated;

create or replace function public.revoke_server_access(p_server uuid, p_user uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_server_owner(p_server,auth.uid()) then raise exception 'Owner permission required'; end if;
  delete from server_members where server_id=p_server and user_id=p_user;
  insert into audit_logs(server_id,user_id,action,details)
  values(p_server,auth.uid(),'member.revoke',jsonb_build_object('target_user_id',p_user));
end;
$$;
revoke all on function public.revoke_server_access(uuid,uuid) from public;
grant execute on function public.revoke_server_access(uuid,uuid) to authenticated;


-- ============================================================================
-- PROVISIONING MIGRATION
-- ============================================================================
-- MC Control Cloud Provisioning MVP migration
-- Run once in Supabase SQL Editor after schema.sql.

alter table public.servers add column if not exists dataset_repo_id text;
alter table public.servers add column if not exists provision_status text not null default 'manual';
alter table public.servers add column if not exists provision_step text;
alter table public.servers add column if not exists provision_error text;
alter table public.servers add column if not exists hardware text default 'zero-a10g';
alter table public.servers add column if not exists template_version text default '2.4.0';
alter table public.servers add column if not exists minecraft_version text default '1.21.1';

create table if not exists public.provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  server_id uuid references public.servers(id) on delete cascade,
  space_repo_id text not null,
  dataset_repo_id text not null,
  state text not null default 'requested',
  step text not null default 'requested',
  progress integer not null default 0 check (progress between 0 and 100),
  error_code text,
  error_message text,
  hardware_warning text,
  retry_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists provisioning_jobs_user_idx on public.provisioning_jobs(user_id, created_at desc);
create index if not exists provisioning_jobs_server_idx on public.provisioning_jobs(server_id);

alter table public.provisioning_jobs enable row level security;

drop policy if exists "users read own provisioning jobs" on public.provisioning_jobs;
create policy "users read own provisioning jobs"
on public.provisioning_jobs for select to authenticated
using (user_id = auth.uid());

-- All writes are performed by Edge Functions using service_role.
revoke insert, update, delete on public.provisioning_jobs from anon, authenticated;
grant select on public.provisioning_jobs to authenticated;
grant all on public.provisioning_jobs to service_role;

notify pgrst, 'reload schema';


-- ============================================================================
-- SOCIAL AUTH MIGRATION
-- ============================================================================
-- Enable Google/GitHub signups that do not provide a SAW username.

alter table public.profiles
add column if not exists username_completed boolean not null default true;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text;
  completed boolean;
begin
  requested := lower(coalesce(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'user_name',
    new.raw_user_meta_data->>'preferred_username',
    ''
  ));
  completed := requested ~ '^[a-z0-9_.-]{3,32}$';

  if not completed then
    requested := 'user_' || substring(replace(new.id::text, '-', '') from 1 for 10);
  end if;

  insert into public.profiles(
    id,
    username,
    display_name,
    avatar_url,
    username_completed
  ) values (
    new.id,
    requested,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', requested),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    completed
  );

  return new;
end;
$$;

notify pgrst, 'reload schema';


-- ============================================================================
-- BETA6 BACKEND HARDENING
-- ============================================================================
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


-- BETA15 BACKEND STABILIZATION
-- SAW MC Hosting v2.0.0-beta.7 feature and audit-retention migration
begin;

alter table public.servers
  alter column template_version set default '3.1.0';

-- Existing rows keep their real version so the UI can offer a controlled upgrade.
create index if not exists servers_template_version_idx
  on public.servers(template_version);

-- Limit profile visibility to yourself and users connected through a visible server.
drop policy if exists "authenticated can read profiles" on public.profiles;
drop policy if exists "users read related profiles" on public.profiles;
create policy "users read related profiles" on public.profiles
for select to authenticated
using (
  id = auth.uid()
  or exists (
    select 1 from public.server_members membership
    where membership.user_id = profiles.id
      and public.can_view_server(membership.server_id)
  )
  or exists (
    select 1 from public.servers owned_server
    where owned_server.owner_id = profiles.id
      and public.can_view_server(owned_server.id)
  )
);

-- Older betas logged every status/log polling request. Remove that free-tier database noise.
delete from public.audit_logs
where action in (
  'agent.status','agent.logs','agent.resources','agent.players',
  'agent.file_list','agent.file_read','agent.backup_list','agent.backup_status'
);

delete from public.audit_logs where created_at < now() - interval '90 days';

create or replace function public.prune_audit_logs()
returns trigger language plpgsql set search_path=public as $$
begin
  if mod(new.id, 100) = 0 then
    delete from public.audit_logs where created_at < now() - interval '90 days';
  end if;
  return new;
end;
$$;
revoke all on function public.prune_audit_logs() from public;

drop trigger if exists audit_logs_retention on public.audit_logs;
create trigger audit_logs_retention after insert on public.audit_logs
for each row execute function public.prune_audit_logs();

commit;
notify pgrst, 'reload schema';

-- SAW Public Beta launch migration
begin;

alter table public.profiles
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested text;
  completed boolean;
  accepted_version text;
begin
  requested := lower(coalesce(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'user_name',
    new.raw_user_meta_data->>'preferred_username',
    ''
  ));
  completed := requested ~ '^[a-z0-9_.-]{3,32}$';
  if not completed then
    requested := 'user_' || substring(replace(new.id::text, '-', '') from 1 for 10);
  end if;
  accepted_version := nullif(trim(coalesce(new.raw_user_meta_data->>'terms_version', '')), '');

  insert into public.profiles(
    id, username, display_name, avatar_url, username_completed,
    terms_version, terms_accepted_at
  ) values (
    new.id,
    requested,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', requested),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    completed,
    accepted_version,
    case when accepted_version is not null then now() else null end
  );
  return new;
end;
$$;

commit;
notify pgrst, 'reload schema';
