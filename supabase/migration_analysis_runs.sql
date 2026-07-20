begin;

create table if not exists public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_file_name text,
  source_file_type text,
  source_file_url text,
  analyzer_type text not null default 'mock',
  status text not null default 'preview',
  detected_row_count integer default 0,
  detected_shot_candidate_count integer default 0,
  generated_shot_count integer default 0,
  final_shot_count integer default 0,
  ai_raw_result jsonb,
  ai_normalized_shots jsonb,
  final_confirmed_shots jsonb,
  warnings jsonb default '[]'::jsonb,
  debug_payload jsonb,
  text_quality jsonb,
  is_text_corrupted boolean not null default false,
  failure_reason text not null default '',
  user_feedback text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint analysis_runs_status_check check (status in ('preview', 'confirmed', 'discarded', 'failed'))
);

create table if not exists public.analysis_run_items (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  original_order_index integer,
  final_order_index integer,
  ai_scene_number text,
  ai_cut_number text,
  ai_title text,
  ai_description text,
  ai_location text,
  ai_characters jsonb default '[]'::jsonb,
  ai_memo text,
  final_scene_number text,
  final_cut_number text,
  final_title text,
  final_description text,
  final_location text,
  final_characters jsonb default '[]'::jsonb,
  final_memo text,
  action text not null default 'unchanged',
  source_sheet text,
  source_page integer,
  source_row integer,
  created_at timestamptz not null default now(),
  constraint analysis_run_items_action_check check (action in ('unchanged', 'edited', 'deleted', 'added'))
);

alter table public.shots
add column if not exists analysis_run_id uuid references public.analysis_runs(id) on delete set null;

create index if not exists idx_analysis_runs_project_id
on public.analysis_runs(project_id);

create index if not exists idx_analysis_runs_created_at
on public.analysis_runs(created_at desc);

create index if not exists idx_analysis_run_items_run_id
on public.analysis_run_items(analysis_run_id);

create index if not exists idx_analysis_run_items_project_id
on public.analysis_run_items(project_id);

create index if not exists idx_shots_analysis_run_id
on public.shots(analysis_run_id);

create index if not exists idx_analysis_runs_failure_reason
on public.analysis_runs(failure_reason);

create index if not exists idx_analysis_runs_is_text_corrupted
on public.analysis_runs(is_text_corrupted);

alter table public.analysis_runs enable row level security;
alter table public.analysis_run_items enable row level security;

drop policy if exists "analysis_runs_select_members" on public.analysis_runs;
create policy "analysis_runs_select_members"
on public.analysis_runs for select
using (public.is_project_member(project_id));

drop policy if exists "analysis_runs_insert_admins" on public.analysis_runs;
create policy "analysis_runs_insert_admins"
on public.analysis_runs for insert
to authenticated
with check (public.is_project_admin(project_id));

drop policy if exists "analysis_runs_update_admins" on public.analysis_runs;
create policy "analysis_runs_update_admins"
on public.analysis_runs for update
to authenticated
using (public.is_project_admin(project_id))
with check (public.is_project_admin(project_id));

drop policy if exists "analysis_runs_delete_admins" on public.analysis_runs;
create policy "analysis_runs_delete_admins"
on public.analysis_runs for delete
to authenticated
using (public.is_project_admin(project_id));

drop policy if exists "analysis_run_items_select_members" on public.analysis_run_items;
create policy "analysis_run_items_select_members"
on public.analysis_run_items for select
using (public.is_project_member(project_id));

drop policy if exists "analysis_run_items_insert_admins" on public.analysis_run_items;
create policy "analysis_run_items_insert_admins"
on public.analysis_run_items for insert
to authenticated
with check (public.is_project_admin(project_id));

drop policy if exists "analysis_run_items_update_admins" on public.analysis_run_items;
create policy "analysis_run_items_update_admins"
on public.analysis_run_items for update
to authenticated
using (public.is_project_admin(project_id))
with check (public.is_project_admin(project_id));

drop policy if exists "analysis_run_items_delete_admins" on public.analysis_run_items;
create policy "analysis_run_items_delete_admins"
on public.analysis_run_items for delete
to authenticated
using (public.is_project_admin(project_id));

commit;
