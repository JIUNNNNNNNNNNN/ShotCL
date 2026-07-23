-- 프로젝트 생성 직후 입력하는 프로젝트 단위 기본정보입니다.
-- daily_plans와 분리되어 있으며, 빈 일촬표 row를 생성하지 않습니다.

alter table public.projects
add column if not exists project_basic_info jsonb not null default '{}'::jsonb;

comment on column public.projects.project_basic_info is
'Project-level total episodes, shooting date range, main staff, and actors';
