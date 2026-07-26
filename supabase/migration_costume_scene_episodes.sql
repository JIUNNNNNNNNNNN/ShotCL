-- 의상 씬별 회차 체크를 저장합니다.
-- 기존 행과 의상 데이터는 유지되며, 여러 번 실행해도 안전합니다.

alter table if exists public.project_costume_scenes
  add column if not exists episode_numbers integer[] not null default '{}'::integer[];

comment on column public.project_costume_scenes.episode_numbers is
  '해당 의상 씬이 포함되는 회차 번호 목록. 일촬표 자동 체크와 수동 체크의 합집합.';
