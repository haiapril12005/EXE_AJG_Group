-- Admin analytics:
-- 1. ai_usage: one row per AI call (who, which feature, which model, tokens, latency, success), so the
--    admin can see what AI costs per feature and per user. Only the service role reads or writes it.
-- 2. Read-only reporting functions the admin API calls: daily activity, the conversion funnel and
--    AI usage grouped by day / feature / model. They are callable by the service role only.

create table if not exists public.ai_usage (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  thought_tokens integer not null default 0,
  total_tokens integer not null default 0,
  latency_ms integer,
  success boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_created_at_idx on public.ai_usage(created_at desc);
create index if not exists ai_usage_user_created_idx on public.ai_usage(user_id, created_at desc);

alter table public.ai_usage enable row level security;
-- No policies: browsers (anon / authenticated) can neither read nor write usage rows.

-- Days are counted in Vietnam time, so "today" matches what the admin sees on the clock.
create or replace function public.admin_daily_activity(p_days integer default 30)
returns table (day date, new_users bigint, analyses bigint, interviews bigint, cvs bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select generate_series(
      (now() at time zone 'Asia/Ho_Chi_Minh')::date - (greatest(1, least(p_days, 365)) - 1),
      (now() at time zone 'Asia/Ho_Chi_Minh')::date,
      interval '1 day'
    )::date as day
  )
  select
    d.day,
    (select count(*) from public.users u where (u.created_at at time zone 'Asia/Ho_Chi_Minh')::date = d.day),
    (select count(*) from public.analyses a where (a.created_at at time zone 'Asia/Ho_Chi_Minh')::date = d.day),
    (select count(*) from public.interview_sessions s where (s.created_at at time zone 'Asia/Ho_Chi_Minh')::date = d.day),
    (select count(*) from public.cv_documents c where (c.created_at at time zone 'Asia/Ho_Chi_Minh')::date = d.day)
  from days d
  order by d.day;
$$;

-- Each step counts distinct users who reached it at least once.
create or replace function public.admin_funnel()
returns table (signed_up bigint, has_cv bigint, analyzed bigint, interviewed bigint, paid bigint, active_7d bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.users),
    (select count(distinct user_id) from public.cv_documents),
    (select count(distinct user_id) from public.analyses),
    (select count(distinct user_id) from public.interview_sessions),
    (select count(distinct user_id) from public.transactions where status = 'SUCCESS'),
    (select count(distinct user_id) from (
      select user_id from public.analyses where created_at >= now() - interval '7 days'
      union select user_id from public.interview_sessions where created_at >= now() - interval '7 days'
      union select user_id from public.cv_documents where created_at >= now() - interval '7 days'
      union select user_id from public.ai_usage where created_at >= now() - interval '7 days' and user_id is not null
    ) recent);
$$;

create or replace function public.admin_ai_usage(p_days integer default 30)
returns table (
  day date, feature text, model text, calls bigint, failed bigint,
  input_tokens bigint, output_tokens bigint, thought_tokens bigint, total_tokens bigint, avg_latency_ms integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (u.created_at at time zone 'Asia/Ho_Chi_Minh')::date,
    u.feature,
    u.model,
    count(*),
    count(*) filter (where not u.success),
    coalesce(sum(u.input_tokens), 0),
    coalesce(sum(u.output_tokens), 0),
    coalesce(sum(u.thought_tokens), 0),
    coalesce(sum(u.total_tokens), 0),
    coalesce(avg(u.latency_ms), 0)::integer
  from public.ai_usage u
  where u.created_at >= (now() at time zone 'Asia/Ho_Chi_Minh')::date - (greatest(1, least(p_days, 365)) - 1)
  group by 1, 2, 3
  order by 1, 2, 3;
$$;

create or replace function public.admin_ai_top_users(p_days integer default 30, p_limit integer default 10)
returns table (user_id uuid, calls bigint, input_tokens bigint, output_tokens bigint, thought_tokens bigint, total_tokens bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select u.user_id, count(*), coalesce(sum(u.input_tokens), 0), coalesce(sum(u.output_tokens), 0),
    coalesce(sum(u.thought_tokens), 0), coalesce(sum(u.total_tokens), 0)
  from public.ai_usage u
  where u.user_id is not null
    and u.created_at >= (now() at time zone 'Asia/Ho_Chi_Minh')::date - (greatest(1, least(p_days, 365)) - 1)
  group by u.user_id
  order by 6 desc
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function public.admin_daily_activity(integer) from public, anon, authenticated;
revoke all on function public.admin_funnel() from public, anon, authenticated;
revoke all on function public.admin_ai_usage(integer) from public, anon, authenticated;
revoke all on function public.admin_ai_top_users(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_daily_activity(integer) to service_role;
grant execute on function public.admin_funnel() to service_role;
grant execute on function public.admin_ai_usage(integer) to service_role;
grant execute on function public.admin_ai_top_users(integer, integer) to service_role;
