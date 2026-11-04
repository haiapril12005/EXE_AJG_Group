create table if not exists public.job_postings (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('greenhouse', 'smartrecruiters')),
  source_key text not null,
  external_id text not null,
  company text not null,
  title text not null,
  location text not null default '',
  city text not null default '',
  description text not null check (char_length(description) between 50 and 20000),
  url text not null,
  posted_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missed_scans integer not null default 0,
  is_active boolean not null default true,
  unique (source, source_key, external_id)
);

create index if not exists job_postings_active_posted_idx on public.job_postings(is_active, posted_at desc);

-- analyses and interview_sessions keep their own jd_text, so reports survive a removed posting.
alter table public.analyses
  add column if not exists job_id uuid references public.job_postings(id) on delete set null;

-- Quick interviews start from a CV and a JD without a full analysis.
alter table public.interview_sessions alter column analysis_id drop not null;

alter table public.job_postings enable row level security;

create policy "Signed-in users can read active job postings" on public.job_postings
  for select to authenticated using (is_active);
