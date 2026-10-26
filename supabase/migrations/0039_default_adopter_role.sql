-- Every account is an adopter from the moment it exists — there is no
-- "general user" and no pending/awaiting-approval state any more. The grant
-- used to be a client call to /api/auth/grant-default-role after signup,
-- which left an account with zero roles whenever that call never ran (e.g.
-- the signup code was never verified). It now happens in the same
-- transaction that creates the auth user, so it can't be skipped.

-- security definer: runs as the function owner so it can write user_roles
-- (RLS, no insert policy) from within Supabase Auth's insert.
create or replace function public.grant_default_adopter_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_roles (user_id, role)
  values (new.id, 'adopter')
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_grant_adopter on auth.users;
create trigger on_auth_user_created_grant_adopter
  after insert on auth.users
  for each row execute function public.grant_default_adopter_role();

-- Backfill: existing accounts without the role (pending signups, or an
-- adopter role an admin had removed) become adopters too.
insert into public.user_roles (user_id, role)
select id, 'adopter' from auth.users
on conflict (user_id, role) do nothing;

-- 'general_user' was never granted by the app; drop any rows and the value.
delete from public.user_roles where role = 'general_user';
alter table public.user_roles drop constraint user_roles_role_check;
alter table public.user_roles add constraint user_roles_role_check
  check (role in ('adopter', 'pathway_contributor', 'admin'));
