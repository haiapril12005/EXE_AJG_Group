-- Adds administrator role with database-enforced assignment guardrails:
-- 1. No direct client/API self-promotion: is_admin can only be changed through
--    service_role RPCs (grant_admin_role / revoke_admin_role) or the SQL Editor superuser.
-- 2. Verified email required: the account must have confirmed its email (OTP) in auth.users.
-- 3. Hard cap on admin count: at most 3 accounts may hold is_admin = true at any time.

alter table public.users
  add column if not exists is_admin boolean not null default false;

create or replace function public.enforce_admin_assignment_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  confirmed_at timestamptz;
  current_admins integer;
  grant_context text;
begin
  -- Leaving is_admin as false needs no special check.
  if new.is_admin is distinct from true then
    -- Revoking admin also requires the authorized grant context or SQL superuser.
    if tg_op = 'UPDATE' and old.is_admin = true and new.is_admin = false then
      grant_context := current_setting('app.admin_grant_context', true);
      if grant_context is distinct from 'authorized_grant' and current_user not in ('postgres', 'supabase_admin') then
        raise exception 'ADMIN_RULE_DIRECT_UPDATE_FORBIDDEN: Chỉ được thay đổi quyền quản trị qua lệnh CLI hoặc hàm quản trị.';
      end if;
    end if;
    return new;
  end if;

  -- If the user is already an admin and another column (e.g. credits) is being updated, allow it.
  if tg_op = 'UPDATE' and old.is_admin = true then
    return new;
  end if;

  -- Rule 1: Only authorized CLI/RPC context or SQL Editor superuser can promote an admin.
  grant_context := current_setting('app.admin_grant_context', true);
  if grant_context is distinct from 'authorized_grant' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'ADMIN_RULE_DIRECT_UPDATE_FORBIDDEN: Không được gán quyền quản trị trực tiếp. Hãy dùng lệnh npm run admin:grant.';
  end if;

  -- Rule 2: The account must have a confirmed email in auth.users.
  select u.email_confirmed_at into confirmed_at
  from auth.users u
  where u.id = new.id;

  if confirmed_at is null then
    raise exception 'ADMIN_RULE_EMAIL_NOT_CONFIRMED: Tài khoản chưa xác thực email (OTP) không được cấp quyền quản trị.';
  end if;

  -- Rule 3: Maximum 3 admins across the entire system.
  select count(*) into current_admins
  from public.users u
  where u.is_admin = true
    and u.id <> new.id;

  if current_admins >= 3 then
    raise exception 'ADMIN_RULE_MAX_LIMIT_REACHED: Hệ thống chỉ cho phép tối đa 3 tài khoản quản trị.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_admin_assignment_rules_trigger on public.users;
create trigger enforce_admin_assignment_rules_trigger
  before insert or update of is_admin on public.users
  for each row execute procedure public.enforce_admin_assignment_rules();

create or replace function public.grant_admin_role(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  target_user public.users%rowtype;
  confirmed_at timestamptz;
  admin_count integer;
begin
  if normalized_email = '' then
    raise exception 'ADMIN_RULE_INVALID_EMAIL: Email không hợp lệ.';
  end if;

  -- Lock current admin rows so concurrent promotions cannot exceed the cap.
  perform 1 from public.users where is_admin = true for update;

  select * into target_user
  from public.users
  where lower(btrim(email)) = normalized_email
  for update;

  if not found then
    raise exception 'ADMIN_RULE_USER_NOT_FOUND: Không tìm thấy tài khoản với email % trong hệ thống.', normalized_email;
  end if;

  select u.email_confirmed_at into confirmed_at
  from auth.users u
  where u.id = target_user.id;

  if confirmed_at is null then
    raise exception 'ADMIN_RULE_EMAIL_NOT_CONFIRMED: Tài khoản % chưa xác thực email (OTP) nên không thể gán quyền quản trị.', normalized_email;
  end if;

  if not target_user.is_admin then
    select count(*) into admin_count
    from public.users
    where is_admin = true;

    if admin_count >= 3 then
      raise exception 'ADMIN_RULE_MAX_LIMIT_REACHED: Đã đủ tối đa 3 tài khoản quản trị. Hãy thu hồi bớt trước khi cấp mới.';
    end if;

    perform set_config('app.admin_grant_context', 'authorized_grant', true);

    update public.users
    set is_admin = true
    where id = target_user.id
    returning * into target_user;
  end if;

  select count(*) into admin_count
  from public.users
  where is_admin = true;

  return jsonb_build_object(
    'id', target_user.id,
    'email', target_user.email,
    'full_name', target_user.full_name,
    'is_admin', target_user.is_admin,
    'admin_count', admin_count,
    'max_admins', 3
  );
end;
$$;

create or replace function public.revoke_admin_role(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  target_user public.users%rowtype;
  admin_count integer;
begin
  if normalized_email = '' then
    raise exception 'ADMIN_RULE_INVALID_EMAIL: Email không hợp lệ.';
  end if;

  select * into target_user
  from public.users
  where lower(btrim(email)) = normalized_email
  for update;

  if not found then
    raise exception 'ADMIN_RULE_USER_NOT_FOUND: Không tìm thấy tài khoản với email % trong hệ thống.', normalized_email;
  end if;

  if target_user.is_admin then
    perform set_config('app.admin_grant_context', 'authorized_grant', true);

    update public.users
    set is_admin = false
    where id = target_user.id
    returning * into target_user;
  end if;

  select count(*) into admin_count
  from public.users
  where is_admin = true;

  return jsonb_build_object(
    'id', target_user.id,
    'email', target_user.email,
    'full_name', target_user.full_name,
    'is_admin', target_user.is_admin,
    'admin_count', admin_count,
    'max_admins', 3
  );
end;
$$;

revoke all on function public.grant_admin_role(text) from public, anon, authenticated;
revoke all on function public.revoke_admin_role(text) from public, anon, authenticated;
grant execute on function public.grant_admin_role(text) to service_role;
grant execute on function public.revoke_admin_role(text) to service_role;

-- To promote a verified user in SQL Editor, run:
-- select public.grant_admin_role('your-email@example.com');

-- Display current users and their admin role status after running this script:
select id, email, full_name, is_admin, credits, created_at
from public.users
order by is_admin desc, created_at desc;


