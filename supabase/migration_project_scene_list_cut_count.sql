-- Per-scene total cut count shared by the scene list and daily-plan editor.
-- Safe to run repeatedly; existing rows are preserved and remain unset (null).

alter table public.project_scene_items
  add column if not exists cut_count integer;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_scene_items_cut_count_range'
      and conrelid = 'public.project_scene_items'::regclass
  ) then
    alter table public.project_scene_items
      add constraint project_scene_items_cut_count_range
      check (cut_count is null or (cut_count >= 0 and cut_count <= 80));
  end if;
end;
$$;

comment on column public.project_scene_items.cut_count is
  'Nullable per-scene total cut count (0 to 80), shared with daily-plan shooting-order validation.';
