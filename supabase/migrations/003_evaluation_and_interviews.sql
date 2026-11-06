alter table public.analyses
  add column if not exists requirements jsonb not null default '[]'::jsonb,
  add column if not exists scoring_breakdown jsonb not null default '[]'::jsonb;

create table if not exists public.cv_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  cv_id uuid not null references public.cv_documents(id) on delete cascade,
  quality_score integer not null check (quality_score between 0 and 100),
  issues jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  cv_id uuid not null references public.cv_documents(id) on delete cascade,
  jd_text text not null,
  questions jsonb not null,
  status text not null default 'IN_PROGRESS' check (status in ('IN_PROGRESS', 'COMPLETED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.interview_answers (
  session_id uuid not null references public.interview_sessions(id) on delete cascade,
  question_index integer not null check (question_index between 0 and 2),
  answer_text text not null check (char_length(answer_text) between 20 and 5000),
  evaluation jsonb not null,
  created_at timestamptz not null default now(),
  primary key (session_id, question_index)
);

create index if not exists cv_evaluations_user_created_idx on public.cv_evaluations(user_id, created_at desc);
create index if not exists interview_sessions_user_created_idx on public.interview_sessions(user_id, created_at desc);

alter table public.cv_evaluations enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.interview_answers enable row level security;

create policy "Users can read own CV evaluations" on public.cv_evaluations
  for select using (auth.uid() = user_id);
create policy "Users can read own interview sessions" on public.interview_sessions
  for select using (auth.uid() = user_id);
create policy "Users can read own interview answers" on public.interview_answers
  for select using (exists (
    select 1 from public.interview_sessions s
    where s.id = session_id and s.user_id = auth.uid()
  ));
