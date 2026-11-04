-- Answering a question again keeps the earlier attempts (newest last, at most 5) so progress stays visible.
-- follow_up holds the interviewer's follow-up question, the candidate's reply and its evaluation.
alter table public.interview_answers
  add column if not exists previous_attempts jsonb not null default '[]'::jsonb,
  add column if not exists follow_up jsonb;

-- Quick practice can run 5 questions; the limit leaves room without letting a session grow unbounded.
alter table public.interview_answers drop constraint if exists interview_answers_question_index_check;
alter table public.interview_answers
  add constraint interview_answers_question_index_check check (question_index between 0 and 9);
