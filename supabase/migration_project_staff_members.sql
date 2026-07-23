-- 프로젝트 전체에서 공유하는 스탭 풀입니다. 기존 회차별 스탭 테이블은 변경하거나 삭제하지 않습니다.
create table if not exists public.project_staff_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  department text not null default '기타',
  name text not null default '',
  phone text not null default '',
  location text not null default '',
  notes text not null default '',
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_staff_members_sort_order_check
    check (sort_order > 0)
);

create index if not exists idx_project_staff_members_scope
  on public.project_staff_members(project_id, sort_order, created_at);

create or replace function public.set_project_staff_members_updated_at()
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
    where tgname = 'project_staff_members_set_updated_at'
      and tgrelid = 'public.project_staff_members'::regclass
  ) then
    create trigger project_staff_members_set_updated_at
    before update on public.project_staff_members
    for each row execute function public.set_project_staff_members_updated_at();
  end if;
end;
$$;

alter table public.project_staff_members enable row level security;

comment on table public.project_staff_members is
  'Project-scoped staff pool. Access is mediated by admin-only project API routes.';
