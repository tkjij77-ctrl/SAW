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
