-- 일촬표별 스텝 상세 목록. 기존 일촬표/컷 데이터는 변경하거나 삭제하지 않습니다.
create table if not exists public.daily_plan_staff_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  daily_plan_id uuid not null references public.daily_plans(id) on delete cascade,
  department text not null default '기타',
  name text not null default '',
  phone text not null default '',
  province text not null default '',
  city_district text not null default '',
  notes text not null default '',
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_plan_staff_members_department_check
    check (length(trim(department)) > 0),
  constraint daily_plan_staff_members_sort_order_check
    check (sort_order > 0)
);

create index if not exists idx_daily_plan_staff_members_scope
  on public.daily_plan_staff_members(project_id, daily_plan_id, department, sort_order);

create index if not exists idx_daily_plan_staff_members_daily_plan
  on public.daily_plan_staff_members(daily_plan_id);

create or replace function public.set_daily_plan_staff_members_updated_at()
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
    where tgname = 'daily_plan_staff_members_set_updated_at'
      and tgrelid = 'public.daily_plan_staff_members'::regclass
  ) then
    create trigger daily_plan_staff_members_set_updated_at
    before update on public.daily_plan_staff_members
    for each row execute function public.set_daily_plan_staff_members_updated_at();
  end if;
end;
$$;

alter table public.daily_plan_staff_members enable row level security;

comment on table public.daily_plan_staff_members is
  'Daily-plan-scoped staff detail rows. Access is mediated by admin-only project API routes.';
