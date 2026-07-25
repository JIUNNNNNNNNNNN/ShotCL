-- 프로젝트 단위 시나리오 PDF, 콘티, 업로드형 부감도와 의상 자료 메타데이터입니다.
-- 기존 storyboards Storage bucket을 재사용하며 기존 데이터는 변경하거나 삭제하지 않습니다.

create extension if not exists pgcrypto;

create table if not exists public.project_reference_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  asset_type text not null,
  filename text not null,
  storage_path text not null,
  public_url text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  daily_plan_id text,
  scene_no text,
  cut_no text,
  shot_ref text,
  group_id text,
  crop_data jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_reference_assets_type_check
    check (asset_type in ('scenario', 'storyboard', 'overhead'))
);

alter table public.project_reference_assets
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists asset_type text,
  add column if not exists filename text,
  add column if not exists storage_path text,
  add column if not exists public_url text,
  add column if not exists mime_type text default 'application/octet-stream',
  add column if not exists size_bytes bigint default 0,
  add column if not exists daily_plan_id text,
  add column if not exists scene_no text,
  add column if not exists cut_no text,
  add column if not exists shot_ref text,
  add column if not exists group_id text,
  add column if not exists crop_data jsonb default '{}'::jsonb,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists project_reference_assets_project_idx
  on public.project_reference_assets (project_id, asset_type, created_at desc);

create index if not exists project_reference_assets_shot_idx
  on public.project_reference_assets (project_id, daily_plan_id, shot_ref)
  where shot_ref is not null;

create unique index if not exists project_reference_assets_overhead_unique
  on public.project_reference_assets (project_id, daily_plan_id, shot_ref, asset_type)
  where asset_type = 'overhead' and daily_plan_id is not null and shot_ref is not null;

create table if not exists public.project_costumes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  character_name text not null default '',
  costume_name text not null default '',
  description text not null default '',
  memo text not null default '',
  image_paths jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_costumes
  add column if not exists project_id uuid references public.projects(id) on delete cascade,
  add column if not exists character_name text default '',
  add column if not exists costume_name text default '',
  add column if not exists description text default '',
  add column if not exists memo text default '',
  add column if not exists image_paths jsonb default '[]'::jsonb,
  add column if not exists sort_order integer default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists project_costumes_project_idx
  on public.project_costumes (project_id, sort_order, created_at);

create or replace function public.set_project_reference_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_project_reference_assets_updated_at on public.project_reference_assets;
create trigger set_project_reference_assets_updated_at
before update on public.project_reference_assets
for each row execute function public.set_project_reference_updated_at();

drop trigger if exists set_project_costumes_updated_at on public.project_costumes;
create trigger set_project_costumes_updated_at
before update on public.project_costumes
for each row execute function public.set_project_reference_updated_at();

alter table public.project_reference_assets enable row level security;
alter table public.project_costumes enable row level security;

-- 브라우저 직접 쓰기는 허용하지 않습니다. 앱 서버가 프로젝트 세션 권한을 확인한 뒤
-- service role로 읽고 쓰므로 service role key는 클라이언트에 노출되지 않습니다.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'storyboards',
  'storyboards',
  true,
  52428800,
  array[
    'application/pdf',
    'application/octet-stream',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = greatest(storage.buckets.file_size_limit, excluded.file_size_limit),
  allowed_mime_types = excluded.allowed_mime_types;
