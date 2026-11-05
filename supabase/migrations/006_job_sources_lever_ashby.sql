-- Lets the job catalog store postings from the Lever and Ashby public job board APIs.
-- Existing rows and the greenhouse/smartrecruiters sources are unchanged; safe to run more than once.
alter table public.job_postings drop constraint if exists job_postings_source_check;
alter table public.job_postings add constraint job_postings_source_check
  check (source in ('greenhouse', 'smartrecruiters', 'lever', 'ashby'));
