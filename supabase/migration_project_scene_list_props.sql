begin;

alter table public.project_scene_items
  add column if not exists props text not null default '';

comment on column public.project_scene_items.props is
  '씬별 주요 소품 메모';

commit;
