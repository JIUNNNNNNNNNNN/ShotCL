create extension if not exists pgcrypto;

create table if not exists public.project_scene_items (
  id uuid primary key default gen_random_uuid(),
  project_id text not null,
  scene_no text not null default '',
  main_location text not null default '',
  sub_location text not null default '',
  day_label text not null default '',
  day_night text not null default '',
  interior_exterior text not null default '',
  scene_content text not null default '',
  characters text not null default '',
  sort_order integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_scene_items
  add column if not exists project_id text,
  add column if not exists scene_no text not null default '',
  add column if not exists main_location text not null default '',
  add column if not exists sub_location text not null default '',
  add column if not exists day_label text not null default '',
  add column if not exists day_night text not null default '',
  add column if not exists interior_exterior text not null default '',
  add column if not exists scene_content text not null default '',
  add column if not exists characters text not null default '',
  add column if not exists sort_order integer not null default 1,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists project_scene_items_project_order_idx
  on public.project_scene_items(project_id, sort_order, created_at);

create table if not exists public.project_scene_notes (
  project_id text primary key,
  scenario_reference text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_scene_notes
  add column if not exists scenario_reference text not null default '',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists project_scene_notes_project_idx
  on public.project_scene_notes(project_id);

create or replace function public.set_project_scene_updated_at()
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
    where tgname = 'project_scene_items_set_updated_at'
      and tgrelid = 'public.project_scene_items'::regclass
  ) then
    create trigger project_scene_items_set_updated_at
    before update on public.project_scene_items
    for each row execute function public.set_project_scene_updated_at();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'project_scene_notes_set_updated_at'
      and tgrelid = 'public.project_scene_notes'::regclass
  ) then
    create trigger project_scene_notes_set_updated_at
    before update on public.project_scene_notes
    for each row execute function public.set_project_scene_updated_at();
  end if;
end;
$$;

alter table public.project_scene_items enable row level security;
alter table public.project_scene_notes enable row level security;

comment on table public.project_scene_items is
  'Project-level scene list rows, independent from daily plans.';

comment on table public.project_scene_notes is
  'Project-level scenario reference text for the scene list editor.';
