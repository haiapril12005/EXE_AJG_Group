-- public.users.email was written once at sign-up. Users can now change their login email from the
-- profile page (confirmed with codes sent to both addresses), so this keeps public.users.email in step.
-- The admin CLI and admin overview look users up by this column. Safe to run more than once.
create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (new.email is not null and old.email is distinct from new.email)
  execute procedure public.sync_user_email();

revoke all on function public.sync_user_email() from public, anon, authenticated;

-- Accounts whose email already changed before this trigger existed.
update public.users u set email = a.email
from auth.users a
where a.id = u.id and a.email is not null and u.email is distinct from a.email;
