-- Per-row, per-actor scene-list cell state.
-- Safe to run repeatedly; no existing rows are deleted or rewritten.

alter table public.project_scene_items
  add column if not exists actor_cells jsonb not null default '{}'::jsonb;

comment on column public.project_scene_items.actor_cells is
  'Per-actor scene cell state: color presence or actor-specific text note.';
