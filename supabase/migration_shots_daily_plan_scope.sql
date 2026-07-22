begin;

alter table public.shots
add column if not exists daily_plan_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'shots_daily_plan_id_fkey'
      and conrelid = 'public.shots'::regclass
  ) then
    alter table public.shots
    add constraint shots_daily_plan_id_fkey
    foreign key (daily_plan_id)
    references public.daily_plans(id)
    on delete set null;
  end if;
end;
$$;

-- 기존 프로젝트 단위 컷은 여러 회차에 복제하지 않고, 해당 프로젝트의
-- 가장 먼저 생성된 일촬표 한 곳에만 안전하게 연결합니다.
update public.shots as shot
set daily_plan_id = (
  select plan.id
  from public.daily_plans as plan
  where plan.project_id = shot.project_id
  order by plan.created_at asc, plan.id asc
  limit 1
)
where shot.daily_plan_id is null
  and exists (
    select 1
    from public.daily_plans as plan
    where plan.project_id = shot.project_id
  );

-- 각 저장된 일촬표 컷을 해당 회차의 진행 컷으로 보완합니다.
-- 이미 같은 회차/씬/컷이 있으면 기존 상태와 콘티를 그대로 보존합니다.
insert into public.shots (
  project_id,
  daily_plan_id,
  scene_number,
  cut_number,
  shot_number,
  title,
  description,
  location,
  characters,
  memo,
  order_index,
  status
)
select
  daily_shot.project_id,
  daily_shot.daily_plan_id,
  daily_shot.scene_number,
  daily_shot.cut_number,
  daily_shot.cut_number,
  coalesce(nullif(left(daily_shot.description, 40), ''), '씬 ' || daily_shot.scene_number || ' 컷 ' || daily_shot.cut_number),
  daily_shot.description,
  daily_shot.location_name,
  case when nullif(trim(daily_shot.subject), '') is null then '{}'::text[] else array[daily_shot.subject] end,
  daily_shot.memo,
  daily_shot.order_index,
  case
    when daily_shot.status = 'OK' then 'ok'
    when daily_shot.status = 'Omit' then 'omit'
    else 'pending'
  end
from public.daily_plan_shots as daily_shot
where nullif(trim(daily_shot.scene_number), '') is not null
  and daily_shot.cut_number ~ '^[0-9]+$'
  and not exists (
    select 1
    from public.shots as progress_shot
    where progress_shot.project_id = daily_shot.project_id
      and progress_shot.daily_plan_id = daily_shot.daily_plan_id
      and progress_shot.scene_number = daily_shot.scene_number
      and progress_shot.cut_number = daily_shot.cut_number
  );

create index if not exists idx_shots_project_daily_plan_order
on public.shots(project_id, daily_plan_id, order_index, created_at);

create index if not exists idx_shots_daily_plan_scene_cut
on public.shots(daily_plan_id, scene_number, cut_number);

commit;
