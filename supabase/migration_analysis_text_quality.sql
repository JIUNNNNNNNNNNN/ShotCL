begin;

alter table public.analysis_runs
add column if not exists text_quality jsonb;

alter table public.analysis_runs
add column if not exists is_text_corrupted boolean not null default false;

alter table public.analysis_runs
add column if not exists failure_reason text not null default '';

alter table public.analysis_runs
drop constraint if exists analysis_runs_status_check;

alter table public.analysis_runs
add constraint analysis_runs_status_check
check (status in ('preview', 'confirmed', 'discarded', 'failed'));

create index if not exists idx_analysis_runs_failure_reason
on public.analysis_runs(failure_reason);

create index if not exists idx_analysis_runs_is_text_corrupted
on public.analysis_runs(is_text_corrupted);

commit;
