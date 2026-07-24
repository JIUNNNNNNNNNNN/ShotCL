-- 프로젝트별 스탭 부서 입력 추천 목록입니다.
-- 실제 스탭 행(project_staff_members)과 독립적으로 관리하며 기존 행을 변경하지 않습니다.
create table if not exists public.project_staff_departments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_staff_departments_name_check
    check (char_length(btrim(name)) between 1 and 100),
  constraint project_staff_departments_sort_order_check
    check (sort_order > 0)
);

alter table public.project_staff_departments
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists project_id uuid,
  add column if not exists name text,
  add column if not exists sort_order integer default 1,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists project_staff_departments_project_name_uidx
  on public.project_staff_departments(project_id, lower(btrim(name)));

create index if not exists idx_project_staff_departments_scope
  on public.project_staff_departments(project_id, sort_order, created_at);

create or replace function public.set_project_staff_departments_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'project_staff_departments_set_updated_at'
      and tgrelid = 'public.project_staff_departments'::regclass
  ) then
    create trigger project_staff_departments_set_updated_at
    before update on public.project_staff_departments
    for each row execute function public.set_project_staff_departments_updated_at();
  end if;
end;
$$;

alter table public.project_staff_departments enable row level security;

comment on table public.project_staff_departments is
  'Project-scoped staff department suggestions. Access is mediated by admin-only project API routes.';
