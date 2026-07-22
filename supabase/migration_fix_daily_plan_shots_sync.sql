begin;

-- 일촬표 회차별 진행표 동기화에 필요한 shots 컬럼을 구형 DB에도 안전하게 보완합니다.
alter table public.shots add column if not exists daily_plan_id uuid;
alter table public.shots add column if not exists scene_number text not null default '';
alter table public.shots add column if not exists cut_number text not null default '';
alter table public.shots add column if not exists shot_number text not null default '';
alter table public.shots add column if not exists title text not null default '';
alter table public.shots add column if not exists description text not null default '';
alter table public.shots add column if not exists location text not null default '';
alter table public.shots add column if not exists characters text[] not null default '{}';
alter table public.shots add column if not exists memo text not null default '';
alter table public.shots add column if not exists notes text not null default '';
alter table public.shots add column if not exists order_index integer not null default 1;
alter table public.shots add column if not exists status text not null default 'pending';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.shots'::regclass
      and conname = 'shots_daily_plan_id_fkey'
  ) then
    alter table public.shots
      add constraint shots_daily_plan_id_fkey
      foreign key (daily_plan_id)
      references public.daily_plans(id)
      on delete set null;
  end if;
end;
$$;

create index if not exists idx_shots_project_daily_plan_order
  on public.shots(project_id, daily_plan_id, order_index);

create index if not exists idx_shots_daily_plan_scene_cut
  on public.shots(daily_plan_id, scene_number, cut_number);

commit;
