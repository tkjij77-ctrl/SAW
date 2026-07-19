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
