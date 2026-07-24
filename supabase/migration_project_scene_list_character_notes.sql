-- Project scene-list character appearance notes.
-- Safe to run repeatedly; no existing rows are deleted or rewritten.

alter table public.project_scene_items
  add column if not exists character_notes text not null default '';

comment on column public.project_scene_items.character_notes is
  'Per-scene appearance details such as V.O, silhouette, distant appearance, or back view.';
