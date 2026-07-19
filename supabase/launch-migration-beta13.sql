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
