create extension if not exists pgcrypto;

do $$
begin
  create type public.project_role as enum ('admin', 'crew');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shoot_date date,
  description text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.project_role not null default 'crew',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.storyboard_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  file_name text not null,
  file_type text not null default 'unknown',
  file_size bigint not null default 0,
  storage_path text not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null default '',
  source_type text not null default 'web_editor',
  source_file_name text not null default '',
  shooting_date date,
  episode text not null default '',
  director text not null default '',
  dop text not null default '',
  assistant_director text not null default '',
  production text not null default '',
  call_time text not null default '',
  shoot_start_time text not null default '',
  shoot_end_time text not null default '',
  meeting_location text not null default '',
  shooting_location text not null default '',
  shooting_locations jsonb not null default '[]'::jsonb,
  meal_time text not null default '',
  meal_times jsonb not null default '[]'::jsonb,
  safety_notice text not null default '',
  memo text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_plans_source_type_check check (source_type in ('web_editor', 'excel_import', 'pdf_ai_import'))
);

create table if not exists public.daily_plan_shots (
  id uuid primary key default gen_random_uuid(),
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  order_index integer not null default 1,
  start_time text not null default '',
  end_time text not null default '',
  scene_number text not null default '',
  scene_title text not null default '',
  location_id text not null default '',
  location_name text not null default '',
  cut_number text not null default '',
  subject text not null default '',
  sub_location text not null default '',
  day_night text not null default '',
  live_sync text not null default '',
  cut_type text not null default '',
  story_day text not null default '',
  description text not null default '',
  props text not null default '',
  costume_makeup text not null default '',
  scene_memo text not null default '',
  memo text not null default '',
  status text not null default '촬영 전',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_plan_shots_status_check check (status in ('촬영 전', '촬영중', 'OK', '보류', 'Omit'))
);

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

create table if not exists public.shots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  analysis_run_id uuid references public.analysis_runs(id) on delete set null,
  scene_number text not null default '',
  cut_number text not null default '',
  shot_number text not null default '',
  title text not null,
  description text not null default '',
  location text not null default '',
  characters text[] not null default '{}',
  memo text not null default '',
  notes text not null default '',
  order_index integer not null default 1,
  status text not null default 'pending',
  storyboard_image_url text,
  source_file_id uuid references public.storyboard_files(id) on delete set null,
  source_page integer,
  source_row integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shots_status_check check (status in ('pending', 'ok', 'omit'))
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

create table if not exists public.shot_status_logs (
  id uuid primary key default gen_random_uuid(),
  shot_id uuid not null references public.shots(id) on delete cascade,
  previous_status text,
  new_status text not null,
  changed_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint shot_status_logs_status_check check (
    (previous_status is null or previous_status in ('pending', 'ok', 'omit'))
    and new_status in ('pending', 'ok', 'omit')
  )
);

create index if not exists projects_created_by_idx on public.projects(created_by);
create index if not exists project_members_user_id_idx on public.project_members(user_id);
create index if not exists storyboard_files_project_id_idx on public.storyboard_files(project_id);
create index if not exists idx_daily_plans_project_id on public.daily_plans(project_id);
create index if not exists idx_daily_plans_updated_at on public.daily_plans(updated_at desc);
create index if not exists idx_daily_plan_shots_daily_plan_id on public.daily_plan_shots(daily_plan_id);
create index if not exists idx_daily_plan_shots_project_order on public.daily_plan_shots(project_id, daily_plan_id, order_index);
create index if not exists idx_analysis_runs_project_id on public.analysis_runs(project_id);
create index if not exists idx_analysis_runs_created_at on public.analysis_runs(created_at desc);
create index if not exists idx_analysis_runs_failure_reason on public.analysis_runs(failure_reason);
create index if not exists idx_analysis_runs_is_text_corrupted on public.analysis_runs(is_text_corrupted);
create index if not exists idx_analysis_run_items_run_id on public.analysis_run_items(analysis_run_id);
create index if not exists idx_analysis_run_items_project_id on public.analysis_run_items(project_id);
create index if not exists shots_project_order_idx on public.shots(project_id, order_index);
create index if not exists shots_project_status_idx on public.shots(project_id, status);
create index if not exists idx_shots_analysis_run_id on public.shots(analysis_run_id);
create index if not exists shot_status_logs_shot_id_idx on public.shot_status_logs(shot_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists daily_plans_set_updated_at on public.daily_plans;
create trigger daily_plans_set_updated_at
before update on public.daily_plans
for each row execute function public.set_updated_at();

drop trigger if exists daily_plan_shots_set_updated_at on public.daily_plan_shots;
create trigger daily_plan_shots_set_updated_at
before update on public.daily_plan_shots
for each row execute function public.set_updated_at();

drop trigger if exists shots_set_updated_at on public.shots;
create trigger shots_set_updated_at
before update on public.shots
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', new.email))
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.add_project_creator_as_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.created_by is not null then
    insert into public.project_members (project_id, user_id, role)
    values (new.id, new.created_by, 'admin')
    on conflict (project_id, user_id) do update set role = 'admin';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_add_creator_member on public.projects;
create trigger projects_add_creator_member
after insert on public.projects
for each row execute function public.add_project_creator_as_admin();

create or replace function public.log_shot_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.shot_status_logs (shot_id, previous_status, new_status, changed_by)
    values (new.id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists shots_log_status_change on public.shots;
create trigger shots_log_status_change
after update on public.shots
for each row execute function public.log_shot_status_change();

create or replace function public.is_project_member(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members
    where project_id = project_uuid
      and user_id = auth.uid()
  );
$$;

create or replace function public.is_project_admin(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.project_members
    where project_id = project_uuid
      and user_id = auth.uid()
      and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.storyboard_files enable row level security;
alter table public.daily_plans enable row level security;
alter table public.daily_plan_shots enable row level security;
alter table public.analysis_runs enable row level security;
alter table public.analysis_run_items enable row level security;
alter table public.shots enable row level security;
alter table public.shot_status_logs enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "projects_select_members" on public.projects;
create policy "projects_select_members"
on public.projects for select
using (public.is_project_member(id));

drop policy if exists "projects_insert_authenticated" on public.projects;
create policy "projects_insert_authenticated"
on public.projects for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "projects_update_admins" on public.projects;
create policy "projects_update_admins"
on public.projects for update
using (public.is_project_admin(id))
with check (public.is_project_admin(id));

drop policy if exists "projects_delete_admins" on public.projects;
create policy "projects_delete_admins"
on public.projects for delete
using (public.is_project_admin(id));

drop policy if exists "project_members_select_members" on public.project_members;
create policy "project_members_select_members"
on public.project_members for select
using (public.is_project_member(project_id));

drop policy if exists "project_members_manage_admins" on public.project_members;
create policy "project_members_manage_admins"
on public.project_members for all
using (public.is_project_admin(project_id))
with check (public.is_project_admin(project_id));

drop policy if exists "storyboard_files_select_members" on public.storyboard_files;
create policy "storyboard_files_select_members"
on public.storyboard_files for select
using (public.is_project_member(project_id));

drop policy if exists "storyboard_files_insert_admins" on public.storyboard_files;
create policy "storyboard_files_insert_admins"
on public.storyboard_files for insert
with check (public.is_project_admin(project_id));

drop policy if exists "storyboard_files_delete_admins" on public.storyboard_files;
create policy "storyboard_files_delete_admins"
on public.storyboard_files for delete
using (public.is_project_admin(project_id));

drop policy if exists "daily_plans_select_members" on public.daily_plans;
create policy "daily_plans_select_members"
on public.daily_plans for select
using (public.is_project_member(project_id));

drop policy if exists "daily_plans_insert_admins" on public.daily_plans;
create policy "daily_plans_insert_admins"
on public.daily_plans for insert
to authenticated
with check (public.is_project_admin(project_id));

drop policy if exists "daily_plans_update_admins" on public.daily_plans;
create policy "daily_plans_update_admins"
on public.daily_plans for update
to authenticated
using (public.is_project_admin(project_id))
with check (public.is_project_admin(project_id));

drop policy if exists "daily_plans_delete_admins" on public.daily_plans;
create policy "daily_plans_delete_admins"
on public.daily_plans for delete
to authenticated
using (public.is_project_admin(project_id));

drop policy if exists "daily_plan_shots_select_members" on public.daily_plan_shots;
create policy "daily_plan_shots_select_members"
on public.daily_plan_shots for select
using (public.is_project_member(project_id));

drop policy if exists "daily_plan_shots_insert_admins" on public.daily_plan_shots;
create policy "daily_plan_shots_insert_admins"
on public.daily_plan_shots for insert
to authenticated
with check (public.is_project_admin(project_id));

drop policy if exists "daily_plan_shots_update_admins" on public.daily_plan_shots;
create policy "daily_plan_shots_update_admins"
on public.daily_plan_shots for update
to authenticated
using (public.is_project_admin(project_id))
with check (public.is_project_admin(project_id));

drop policy if exists "daily_plan_shots_delete_admins" on public.daily_plan_shots;
create policy "daily_plan_shots_delete_admins"
on public.daily_plan_shots for delete
to authenticated
using (public.is_project_admin(project_id));

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

drop policy if exists "shots_select_members" on public.shots;
create policy "shots_select_members"
on public.shots for select
using (public.is_project_member(project_id));

drop policy if exists "shots_insert_admins" on public.shots;
create policy "shots_insert_admins"
on public.shots for insert
with check (public.is_project_admin(project_id));

drop policy if exists "shots_update_members" on public.shots;
create policy "shots_update_members"
on public.shots for update
using (public.is_project_member(project_id))
with check (public.is_project_member(project_id));

drop policy if exists "shots_delete_admins" on public.shots;
create policy "shots_delete_admins"
on public.shots for delete
using (public.is_project_admin(project_id));

drop policy if exists "shot_status_logs_select_members" on public.shot_status_logs;
create policy "shot_status_logs_select_members"
on public.shot_status_logs for select
using (
  exists (
    select 1
    from public.shots
    where shots.id = shot_status_logs.shot_id
      and public.is_project_member(shots.project_id)
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'storyboards',
  'storyboards',
  true,
  52428800,
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "storyboards_select_members" on storage.objects;
create policy "storyboards_select_members"
on storage.objects for select
using (
  bucket_id = 'storyboards'
  and public.is_project_member(((storage.foldername(name))[2])::uuid)
);

drop policy if exists "storyboards_insert_admins" on storage.objects;
create policy "storyboards_insert_admins"
on storage.objects for insert
with check (
  bucket_id = 'storyboards'
  and public.is_project_admin(((storage.foldername(name))[2])::uuid)
);

drop policy if exists "storyboards_delete_admins" on storage.objects;
create policy "storyboards_delete_admins"
on storage.objects for delete
using (
  bucket_id = 'storyboards'
  and public.is_project_admin(((storage.foldername(name))[2])::uuid)
);

alter table public.shots replica identity full;

do $$
begin
  alter publication supabase_realtime add table public.shots;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
