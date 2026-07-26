-- 부감도/콘티 아카이브의 프로젝트별 폴더입니다.
-- 기존 자료는 삭제하거나 이동하지 않으며, 폴더가 없는 자료는 계속 "미분류"로 표시됩니다.

create extension if not exists pgcrypto;

create table if not exists public.project_archive_folders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_archive_folders
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists name text,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists project_archive_folders_project_name_unique
  on public.project_archive_folders (project_id, lower(name));

create index if not exists project_archive_folders_project_sort_idx
  on public.project_archive_folders (project_id, sort_order, created_at);

-- asset 테이블의 기존 crop_data JSONB를 재사용해 folderId와 thumbnail 정보를 저장합니다.
create index if not exists project_reference_assets_folder_idx
  on public.project_reference_assets (
    project_id,
    asset_type,
    ((crop_data ->> 'folderId'))
  );

create or replace function public.set_project_archive_folder_updated_at()
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
    where tgname = 'set_project_archive_folders_updated_at'
      and tgrelid = 'public.project_archive_folders'::regclass
  ) then
    create trigger set_project_archive_folders_updated_at
    before update on public.project_archive_folders
    for each row execute function public.set_project_archive_folder_updated_at();
  end if;
end;
$$;

alter table public.project_archive_folders enable row level security;

-- 브라우저가 이 테이블에 직접 쓰지 않습니다.
-- 앱 서버가 프로젝트 세션과 Key staff 권한을 확인한 뒤 service role로 읽고 씁니다.
