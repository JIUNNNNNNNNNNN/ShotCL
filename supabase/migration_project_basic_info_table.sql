-- 프로젝트 단위 기본정보를 일촬표와 분리해 저장합니다.
-- 기존 public.projects 및 daily_plans 데이터는 수정하거나 삭제하지 않습니다.

create extension if not exists pgcrypto;

create table if not exists public.project_basic_info (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  total_episodes integer not null default 1,
  shooting_start_date date,
  shooting_end_date date,
  main_staff jsonb not null default
    '{"director":{"name":"","phone":""},"assistantDirector":{"name":"","phone":""},"producer":{"name":"","phone":""}}'::jsonb,
  actors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_basic_info_total_episodes_check
    check (total_episodes >= 1),
  constraint project_basic_info_shooting_date_range_check
    check (
      shooting_start_date is null
      or shooting_end_date is null
      or shooting_start_date <= shooting_end_date
    ),
  constraint project_basic_info_main_staff_object_check
    check (jsonb_typeof(main_staff) = 'object'),
  constraint project_basic_info_actors_array_check
    check (jsonb_typeof(actors) = 'array')
);

-- 같은 이름의 빈/부분 테이블이 먼저 만들어진 환경에서도 필요한 컬럼을 보완합니다.
alter table public.project_basic_info
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists total_episodes integer not null default 1,
  add column if not exists shooting_start_date date,
  add column if not exists shooting_end_date date,
  add column if not exists main_staff jsonb not null default
    '{"director":{"name":"","phone":""},"assistantDirector":{"name":"","phone":""},"producer":{"name":"","phone":""}}'::jsonb,
  add column if not exists actors jsonb not null default '[]'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists project_basic_info_project_id_uidx
on public.project_basic_info(project_id);

comment on table public.project_basic_info is
'Project-level episode count, shooting date range, main staff, and actors';

comment on column public.project_basic_info.main_staff is
'JSON object containing director, assistantDirector, and producer name/phone values';

comment on column public.project_basic_info.actors is
'JSON array containing role/name objects';

do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    execute $function$
      create function public.set_updated_at()
      returns trigger
      language plpgsql
      as $body$
      begin
        new.updated_at = now();
        return new;
      end;
      $body$
    $function$;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'project_basic_info_set_updated_at'
      and tgrelid = 'public.project_basic_info'::regclass
      and not tgisinternal
  ) then
    create trigger project_basic_info_set_updated_at
    before update on public.project_basic_info
    for each row execute function public.set_updated_at();
  end if;
end
$$;

alter table public.project_basic_info enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_basic_info'
      and policyname = 'project_basic_info_select_members'
  ) then
    create policy "project_basic_info_select_members"
    on public.project_basic_info for select
    using (public.is_project_member(project_id));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_basic_info'
      and policyname = 'project_basic_info_insert_admins'
  ) then
    create policy "project_basic_info_insert_admins"
    on public.project_basic_info for insert
    with check (public.is_project_admin(project_id));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_basic_info'
      and policyname = 'project_basic_info_update_admins'
  ) then
    create policy "project_basic_info_update_admins"
    on public.project_basic_info for update
    using (public.is_project_admin(project_id))
    with check (public.is_project_admin(project_id));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'project_basic_info'
      and policyname = 'project_basic_info_delete_admins'
  ) then
    create policy "project_basic_info_delete_admins"
    on public.project_basic_info for delete
    using (public.is_project_admin(project_id));
  end if;
end
$$;
