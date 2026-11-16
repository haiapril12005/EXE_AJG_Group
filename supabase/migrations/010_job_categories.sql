-- Groups job postings by occupation so the job list can be filtered by it.
-- The job sync picks each posting's category from its title. After running this file, run
-- `npm run jobs:sync` once so postings already in the catalog get theirs; until then they show under "Khác".
-- Safe to run more than once.
alter table public.job_postings add column if not exists category text not null default 'other';

create index if not exists job_postings_active_category_idx
  on public.job_postings (is_active, category, posted_at desc);

-- How many active postings each category has, optionally in one city. Only the API (service role) calls it.
create or replace function public.job_category_counts(p_city text default null)
returns table (category text, total bigint)
language sql
stable
set search_path = ''
as $$
  select job.category, count(*)
  from public.job_postings as job
  where job.is_active and (p_city is null or job.city = p_city)
  group by job.category;
$$;

revoke execute on function public.job_category_counts(text) from public, anon, authenticated;
grant execute on function public.job_category_counts(text) to service_role;
