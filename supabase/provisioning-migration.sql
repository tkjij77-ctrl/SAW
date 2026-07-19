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
