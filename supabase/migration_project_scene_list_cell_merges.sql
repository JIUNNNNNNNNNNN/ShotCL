-- 씬리스트의 명시적 셀 병합 범위를 프로젝트별 JSON 배열로 보존합니다.
-- NULL은 기존 데이터가 아직 명시적 병합 모델로 전환되지 않았음을 뜻하고,
-- []는 사용자가 모든 병합을 해제한 상태를 뜻하므로 기본값을 두지 않습니다.

alter table public.project_scene_notes
  add column if not exists cell_merges jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_scene_notes_cell_merges_array_check'
      and conrelid = 'public.project_scene_notes'::regclass
  ) then
    alter table public.project_scene_notes
      add constraint project_scene_notes_cell_merges_array_check
      check (cell_merges is null or jsonb_typeof(cell_merges) = 'array')
      not valid;
  end if;
end;
$$;

alter table public.project_scene_notes enable row level security;

create index if not exists project_scene_notes_cell_merges_gin_idx
  on public.project_scene_notes using gin (cell_merges);

comment on column public.project_scene_notes.cell_merges is
  'Explicit scene-list cell merge ranges. NULL means legacy/unmaterialized; [] means explicitly unmerged.';

-- 선택 칸 비우기는 여러 column을 한 transaction에서 처리하여 일부만 저장되는
-- 상태를 막습니다. service-role 서버 API만 호출할 수 있고 기존 RLS를 우회하지 않습니다.
create or replace function public.clear_project_scene_list_cells(
  p_project_id text,
  p_cells jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_expected integer := 0;
  v_updated integer := 0;
begin
  if p_project_id is null or btrim(p_project_id) = '' then
    raise exception using errcode = '22023', message = 'project id is required';
  end if;
  if p_cells is null or jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) > 5000 then
    raise exception using errcode = '22023', message = 'scene-list clear cells must be an array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_cells) as entry
    where coalesce(entry->>'sceneId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or coalesce(entry->>'column', '') not in ('location', 'subLocation', 'day', 'time', 'intExt')
  ) then
    raise exception using errcode = '22023', message = 'invalid scene-list clear cell';
  end if;

  with requested as (
    select distinct
      (entry->>'sceneId')::uuid as scene_id,
      entry->>'column' as column_key
    from jsonb_array_elements(p_cells) as entry
  )
  select count(distinct scene_id) into v_expected from requested;

  with requested as (
    select distinct
      (entry->>'sceneId')::uuid as scene_id,
      entry->>'column' as column_key
    from jsonb_array_elements(p_cells) as entry
  ), per_scene as (
    select
      scene_id,
      bool_or(column_key = 'location') as clear_location,
      bool_or(column_key = 'subLocation') as clear_sub_location,
      bool_or(column_key = 'day') as clear_day,
      bool_or(column_key = 'time') as clear_time,
      bool_or(column_key = 'intExt') as clear_int_ext
    from requested
    group by scene_id
  )
  update public.project_scene_items as item
  set
    main_location = case when target.clear_location then '' else item.main_location end,
    sub_location = case when target.clear_sub_location then '' else item.sub_location end,
    day_label = case when target.clear_day then '' else item.day_label end,
    day_night = case when target.clear_time then '' else item.day_night end,
    interior_exterior = case when target.clear_int_ext then '' else item.interior_exterior end
  from per_scene as target
  where item.project_id = p_project_id
    and item.id = target.scene_id;

  get diagnostics v_updated = row_count;
  if v_updated <> v_expected then
    raise exception using errcode = '23503', message = 'scene-list row scope mismatch';
  end if;
  return v_updated;
end;
$$;

revoke all on function public.clear_project_scene_list_cells(text, jsonb) from public;
revoke all on function public.clear_project_scene_list_cells(text, jsonb) from anon;
revoke all on function public.clear_project_scene_list_cells(text, jsonb) from authenticated;
grant execute on function public.clear_project_scene_list_cells(text, jsonb) to service_role;
