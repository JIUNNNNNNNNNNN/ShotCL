create extension if not exists pgcrypto;

create table if not exists public.shot_diagrams (
  id uuid primary key default gen_random_uuid(),

  project_id text not null,
  daily_plan_id text,
  shot_ref text not null,

  diagram_type text not null default 'overhead',
  data jsonb not null default '{
    "version": 1,
    "canvas": { "width": 1200, "height": 800 },
    "people": [],
    "cameras": [],
    "lines": [],
    "shapes": []
  }'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint shot_diagrams_diagram_type_check
    check (diagram_type in ('overhead'))
);

create unique index if not exists shot_diagrams_unique_shot_diagram
on public.shot_diagrams (
  project_id,
  daily_plan_id,
  shot_ref,
  diagram_type
);

create index if not exists shot_diagrams_project_id_idx
on public.shot_diagrams (project_id);

create index if not exists shot_diagrams_daily_plan_id_idx
on public.shot_diagrams (daily_plan_id);

create or replace function public.set_shot_diagrams_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_shot_diagrams_updated_at on public.shot_diagrams;

create trigger set_shot_diagrams_updated_at
before update on public.shot_diagrams
for each row
execute function public.set_shot_diagrams_updated_at();
