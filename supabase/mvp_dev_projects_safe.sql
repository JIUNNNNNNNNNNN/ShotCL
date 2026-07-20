-- MVP 개발용 안전 복구 SQL
-- 목적: projects 컬럼 형태를 앱 코드와 맞추고, RLS는 로그인/익명 인증 세션 기반으로 유지합니다.
-- Supabase Dashboard > Authentication > Providers에서 Anonymous sign-ins를 켜면
-- 앱이 로그인 화면 없이 authenticated 세션을 만들 수 있습니다.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shoot_date date,
  description text not null default '',
  created_by uuid null references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.projects alter column shoot_date drop not null;
alter table public.projects alter column description set default '';
alter table public.projects alter column created_by drop not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

drop policy if exists "projects_insert_authenticated" on public.projects;
create policy "projects_insert_authenticated"
on public.projects
for insert
to authenticated
with check (created_by = auth.uid());

drop policy if exists "projects_select_members" on public.projects;
drop policy if exists "projects_select_own_authenticated" on public.projects;
create policy "projects_select_own_authenticated"
on public.projects
for select
to authenticated
using (created_by = auth.uid());

drop policy if exists "projects_update_admins" on public.projects;
drop policy if exists "projects_update_own_authenticated" on public.projects;
create policy "projects_update_own_authenticated"
on public.projects
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());
