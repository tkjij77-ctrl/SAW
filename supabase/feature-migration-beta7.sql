-- SAW MC Hosting v2.0.0-beta.7 feature and audit-retention migration
begin;

alter table public.servers
  alter column template_version set default '3.2.0';

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
