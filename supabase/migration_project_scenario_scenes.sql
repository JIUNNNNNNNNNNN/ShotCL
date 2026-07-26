-- 시나리오 PDF의 씬별 텍스트 분할 결과를 기존 자료 레코드에 저장합니다.
-- 기존 자료와 Storage 파일은 변경하거나 삭제하지 않습니다.

alter table public.project_reference_assets
  add column if not exists scenario_scenes jsonb not null default '[]'::jsonb,
  add column if not exists scenario_parse_error text;

comment on column public.project_reference_assets.scenario_scenes is
  '시나리오 PDF에서 자동 분할하거나 Key staff가 수동 편집한 씬 배열';

comment on column public.project_reference_assets.scenario_parse_error is
  '텍스트 추출 또는 자동 씬 분할 실패 시 사용자에게 표시할 안전한 오류';
