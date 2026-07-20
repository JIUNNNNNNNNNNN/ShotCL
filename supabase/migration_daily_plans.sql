begin;

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

create index if not exists idx_daily_plans_project_id
on public.daily_plans(project_id);

create index if not exists idx_daily_plans_updated_at
on public.daily_plans(updated_at desc);

create index if not exists idx_daily_plan_shots_daily_plan_id
on public.daily_plan_shots(daily_plan_id);

create index if not exists idx_daily_plan_shots_project_order
on public.daily_plan_shots(project_id, daily_plan_id, order_index);

alter table public.daily_plans
add column if not exists shooting_locations jsonb not null default '[]'::jsonb;

alter table public.daily_plans
add column if not exists meal_times jsonb not null default '[]'::jsonb;

alter table public.daily_plan_shots
add column if not exists scene_title text not null default '';

alter table public.daily_plan_shots
add column if not exists location_id text not null default '';

alter table public.daily_plan_shots
add column if not exists location_name text not null default '';

alter table public.daily_plan_shots
add column if not exists scene_memo text not null default '';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists daily_plans_set_updated_at on public.daily_plans;
create trigger daily_plans_set_updated_at
before update on public.daily_plans
for each row execute function public.set_updated_at();

drop trigger if exists daily_plan_shots_set_updated_at on public.daily_plan_shots;
create trigger daily_plan_shots_set_updated_at
before update on public.daily_plan_shots
for each row execute function public.set_updated_at();

alter table public.daily_plans enable row level security;
alter table public.daily_plan_shots enable row level security;

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

commit;
