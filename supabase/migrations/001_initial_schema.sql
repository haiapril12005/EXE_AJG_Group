create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  credits integer not null default 1 check (credits >= 0),
  created_at timestamptz not null default now()
);

create table public.cv_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  original_name text not null,
  raw_text text not null,
  masked_text text not null,
  created_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cv_id uuid not null references public.cv_documents(id) on delete cascade,
  jd_text text not null,
  rci_score integer not null check (rci_score between 0 and 100),
  layer_1_skills jsonb not null,
  layer_2_projects jsonb not null,
  layer_3_education jsonb not null,
  layer_4_mock jsonb,
  is_premium_unlocked boolean not null default false,
  created_at timestamptz not null default now()
);

create type public.transaction_status as enum ('PENDING', 'SUCCESS', 'CANCELLED');

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  order_code bigint not null unique,
  amount integer not null check (amount = 29000),
  status public.transaction_status not null default 'PENDING',
  created_at timestamptz not null default now()
);

create index cv_documents_user_id_created_at_idx on public.cv_documents(user_id, created_at desc);
create index analyses_user_id_created_at_idx on public.analyses(user_id, created_at desc);
create index transactions_user_id_created_at_idx on public.transactions(user_id, created_at desc);

alter table public.users enable row level security;
alter table public.cv_documents enable row level security;
alter table public.analyses enable row level security;
alter table public.transactions enable row level security;

create policy "Users can read own profile" on public.users
  for select using (auth.uid() = id);
create policy "Users can read own CVs" on public.cv_documents
  for select using (auth.uid() = user_id);
create policy "Users can read own analyses" on public.analyses
  for select using (auth.uid() = user_id);
create policy "Users can read own transactions" on public.transactions
  for select using (auth.uid() = user_id);

create function public.create_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.create_user_profile();

create function public.consume_credit(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining integer;
begin
  update public.users
  set credits = credits - 1
  where id = p_user_id and credits > 0
  returning credits into remaining;
  return remaining;
end;
$$;

create function public.refund_credit(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.users set credits = credits + 1 where id = p_user_id;
$$;

create function public.complete_payment(p_order_code bigint, p_amount integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_user_id uuid;
begin
  update public.transactions
  set status = 'SUCCESS'
  where order_code = p_order_code
    and amount = p_amount
    and status = 'PENDING'
  returning user_id into payment_user_id;

  if payment_user_id is null then
    return false;
  end if;

  update public.users set credits = credits + 3 where id = payment_user_id;
  return true;
end;
$$;

create function public.unlock_analysis(p_user_id uuid, p_analysis_id uuid, p_questions jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_questions jsonb;
  remaining integer;
begin
  select layer_4_mock into existing_questions
  from public.analyses
  where id = p_analysis_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'ANALYSIS_NOT_FOUND';
  end if;

  if existing_questions is not null then
    select credits into remaining from public.users where id = p_user_id;
    return jsonb_build_object(
      'layer_4_mock', existing_questions,
      'credits_remaining', remaining,
      'already_unlocked', true
    );
  end if;

  update public.users
  set credits = credits - 1
  where id = p_user_id and credits > 0
  returning credits into remaining;

  if remaining is null then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  update public.analyses
  set layer_4_mock = p_questions, is_premium_unlocked = true
  where id = p_analysis_id and user_id = p_user_id;

  return jsonb_build_object(
    'layer_4_mock', p_questions,
    'credits_remaining', remaining,
    'already_unlocked', false
  );
end;
$$;

revoke all on function public.consume_credit(uuid) from public, anon, authenticated;
revoke all on function public.refund_credit(uuid) from public, anon, authenticated;
revoke all on function public.complete_payment(bigint, integer) from public, anon, authenticated;
revoke all on function public.unlock_analysis(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.consume_credit(uuid) to service_role;
grant execute on function public.refund_credit(uuid) to service_role;
grant execute on function public.complete_payment(bigint, integer) to service_role;
grant execute on function public.unlock_analysis(uuid, uuid, jsonb) to service_role;
