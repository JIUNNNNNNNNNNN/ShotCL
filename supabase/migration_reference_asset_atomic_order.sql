-- 콘티·부감도 이미지의 씬/컷 이동과 그룹 순서 저장을 한 DB transaction에서 처리합니다.
-- 기존 테이블·행은 삭제하지 않으며 앱 서버의 service-role client만 실행할 수 있습니다.

begin;

create or replace function public.archive_reference_scene_id(p_crop_data jsonb)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when jsonb_typeof(p_crop_data -> 'sceneId') = 'string'
      then nullif(left(btrim(p_crop_data ->> 'sceneId'), 100), '')
    else null
  end;
$$;

create or replace function public.archive_reference_cut_number(
  p_crop_data jsonb,
  p_cut_no text
)
returns integer
language sql
immutable
parallel safe
as $$
  with value as (
    select
      btrim(coalesce(case
        when p_crop_data ? 'cutNumber'
          and p_crop_data -> 'cutNumber' <> 'null'::jsonb
          then p_crop_data ->> 'cutNumber'
        else p_crop_data ->> 'cutNo'
      end, '')) as crop_raw,
      btrim(coalesce(p_cut_no, '')) as legacy_raw
  )
  select coalesce(
    case when crop_raw ~ '^[1-9][0-9]{0,8}$' then crop_raw::integer end,
    case when legacy_raw ~ '^[1-9][0-9]{0,8}$' then legacy_raw::integer end
  )
  from value;
$$;

create or replace function public.is_orderable_archive_reference_asset(
  p_asset_type text,
  p_mime_type text,
  p_filename text,
  p_group_id text
)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(p_asset_type, '') in ('overhead', 'storyboard')
    and (
      lower(btrim(coalesce(p_mime_type, ''))) in ('image/jpeg', 'image/png', 'image/webp')
      or lower(btrim(coalesce(p_filename, ''))) ~ '\.(jpe?g|png|webp)$'
    )
    and coalesce(p_group_id, '') not like 'source:%';
$$;

create or replace function public.archive_move_reference_asset_scene_cut(
  p_project_id uuid,
  p_asset_id uuid,
  p_scene_id uuid,
  p_cut_number integer,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $$
declare
  v_asset public.project_reference_assets%rowtype;
  v_previous_scene_id text;
  v_previous_cut_number integer;
  v_next_scene_id text := case when p_scene_id is null then null else p_scene_id::text end;
  v_scene_number text := '';
  v_scene_cut_count integer;
  v_next_order integer;
  v_same_group boolean;
  v_lock_key bigint;
  v_asset_result jsonb;
  v_order_results jsonb;
begin
  if p_expected_updated_at is null then
    raise exception '자료의 저장 버전이 필요합니다.' using errcode = '22023';
  end if;
  if p_cut_number is not null and p_cut_number < 1 then
    raise exception '컷은 1 이상의 정수로 입력해주세요.' using errcode = '22023';
  end if;
  if p_cut_number is not null and p_scene_id is null then
    raise exception '컷을 설정하려면 씬을 먼저 선택해주세요.' using errcode = '22023';
  end if;

  if p_scene_id is not null then
    select btrim(coalesce(scene.scene_no, '')), scene.cut_count
      into v_scene_number, v_scene_cut_count
    from public.project_scene_items as scene
    where scene.id = p_scene_id
      and scene.project_id = p_project_id::text
    for share;
    if not found then
      raise exception '선택한 씬을 찾을 수 없습니다.' using errcode = '22023';
    end if;
    if p_cut_number is not null and coalesce(v_scene_cut_count, 0) < 1 then
      raise exception '선택한 씬의 총 컷수를 먼저 입력해주세요.' using errcode = '22023';
    end if;
    if p_cut_number is not null and p_cut_number > v_scene_cut_count then
      raise exception '선택한 씬의 총 컷수 %를 초과했습니다.', v_scene_cut_count using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('archive-asset:' || p_asset_id::text, 0));

  select asset.*
    into v_asset
  from public.project_reference_assets as asset
  where asset.id = p_asset_id
    and asset.project_id = p_project_id;
  if not found then
    raise exception '수정할 이미지 자료를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if not public.is_orderable_archive_reference_asset(
    v_asset.asset_type,
    v_asset.mime_type,
    v_asset.filename,
    v_asset.group_id
  ) then
    raise exception '이 자료는 씬·컷 순서를 지정할 수 없습니다.' using errcode = '22023';
  end if;

  v_previous_scene_id := public.archive_reference_scene_id(v_asset.crop_data);
  v_previous_cut_number := public.archive_reference_cut_number(v_asset.crop_data, v_asset.cut_no);
  v_same_group := v_previous_scene_id is not distinct from v_next_scene_id
    and v_previous_cut_number is not distinct from p_cut_number;

  for v_lock_key in
    select distinct hashtextextended(group_key, 0) as lock_key
    from unnest(array[
      'archive-group:' || p_project_id::text || ':' || coalesce(v_previous_scene_id, 'unassigned') || ':' || coalesce(v_previous_cut_number::text, 'unassigned'),
      'archive-group:' || p_project_id::text || ':' || coalesce(v_next_scene_id, 'unassigned') || ':' || coalesce(p_cut_number::text, 'unassigned')
    ]) as group_key
    order by lock_key
  loop
    perform pg_advisory_xact_lock(v_lock_key);
  end loop;

  -- 두 요청이 같은 그룹들을 반대 방향으로 이동해도 동일한 row id 순서로 잠급니다.
  perform 1
  from public.project_reference_assets as asset
  where asset.project_id = p_project_id
    and public.is_orderable_archive_reference_asset(
      asset.asset_type,
      asset.mime_type,
      asset.filename,
      asset.group_id
    )
    and (
      (
        public.archive_reference_scene_id(asset.crop_data) is not distinct from v_previous_scene_id
        and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from v_previous_cut_number
      )
      or (
        public.archive_reference_scene_id(asset.crop_data) is not distinct from v_next_scene_id
        and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from p_cut_number
      )
    )
  order by asset.id
  for update;

  select asset.*
    into v_asset
  from public.project_reference_assets as asset
  where asset.id = p_asset_id
    and asset.project_id = p_project_id
  for update;
  if not found then
    raise exception '수정할 이미지 자료를 찾을 수 없습니다.' using errcode = 'P0002';
  end if;
  if not public.is_orderable_archive_reference_asset(
    v_asset.asset_type,
    v_asset.mime_type,
    v_asset.filename,
    v_asset.group_id
  ) then
    raise exception '이 자료는 씬·컷 순서를 지정할 수 없습니다.' using errcode = '22023';
  end if;
  if v_asset.updated_at is distinct from p_expected_updated_at then
    v_asset_result := jsonb_build_object(
      'id', v_asset.id,
      'sceneId', public.archive_reference_scene_id(v_asset.crop_data),
      'sceneNumber', coalesce(v_asset.crop_data ->> 'sceneNumber', ''),
      'cutNumber', public.archive_reference_cut_number(v_asset.crop_data, v_asset.cut_no),
      'sortOrder', v_asset.sort_order,
      'updatedAt', v_asset.updated_at
    );
    return jsonb_build_object(
      'ok', false,
      'code', 'STALE_ASSET',
      'asset', v_asset_result,
      'orders', '[]'::jsonb
    );
  end if;
  if public.archive_reference_scene_id(v_asset.crop_data) is distinct from v_previous_scene_id
    or public.archive_reference_cut_number(v_asset.crop_data, v_asset.cut_no) is distinct from v_previous_cut_number then
    raise exception '자료의 씬·컷이 다른 요청에서 먼저 변경되었습니다.' using errcode = '40001';
  end if;

  if v_same_group then
    v_next_order := greatest(coalesce(v_asset.sort_order, 0), 1);
  else
    select count(*)::integer + 1
      into v_next_order
    from public.project_reference_assets as asset
    where asset.project_id = p_project_id
      and asset.id <> p_asset_id
      and public.is_orderable_archive_reference_asset(
        asset.asset_type,
        asset.mime_type,
        asset.filename,
        asset.group_id
      )
      and public.archive_reference_scene_id(asset.crop_data) is not distinct from v_next_scene_id
      and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from p_cut_number;
  end if;

  update public.project_reference_assets as asset
  set crop_data = coalesce(asset.crop_data, '{}'::jsonb) || jsonb_build_object(
      'sceneId', v_next_scene_id,
      'sceneNumber', v_scene_number,
      'cutNumber', p_cut_number
    ),
    scene_no = nullif(v_scene_number, ''),
    cut_no = case when p_cut_number is null then null else p_cut_number::text end,
    sort_order = v_next_order
  where asset.id = p_asset_id
    and asset.project_id = p_project_id;

  -- 이동 후 이전 그룹과 새 그룹을 각각 1부터 연속된 순서로 정규화합니다.
  with affected as materialized (
    select
      asset.id,
      row_number() over (
        partition by
          public.archive_reference_scene_id(asset.crop_data),
          public.archive_reference_cut_number(asset.crop_data, asset.cut_no)
        order by
          case when not v_same_group and asset.id = p_asset_id then 1 else 0 end,
          case when asset.sort_order > 0 then asset.sort_order else 0 end,
          asset.created_at,
          asset.id
      )::integer as next_order
    from public.project_reference_assets as asset
    where asset.project_id = p_project_id
      and public.is_orderable_archive_reference_asset(
        asset.asset_type,
        asset.mime_type,
        asset.filename,
        asset.group_id
      )
      and (
        (
          public.archive_reference_scene_id(asset.crop_data) is not distinct from v_previous_scene_id
          and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from v_previous_cut_number
        )
        or (
          public.archive_reference_scene_id(asset.crop_data) is not distinct from v_next_scene_id
          and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from p_cut_number
        )
      )
  )
  update public.project_reference_assets as asset
  set sort_order = affected.next_order
  from affected
  where asset.id = affected.id
    and asset.project_id = p_project_id
    and asset.sort_order is distinct from affected.next_order;

  select jsonb_build_object(
      'id', asset.id,
      'sceneId', public.archive_reference_scene_id(asset.crop_data),
      'sceneNumber', coalesce(asset.crop_data ->> 'sceneNumber', ''),
      'cutNumber', public.archive_reference_cut_number(asset.crop_data, asset.cut_no),
      'sortOrder', asset.sort_order,
      'updatedAt', asset.updated_at
    )
    into v_asset_result
  from public.project_reference_assets as asset
  where asset.id = p_asset_id
    and asset.project_id = p_project_id;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', asset.id,
          'sortOrder', asset.sort_order,
          'updatedAt', asset.updated_at
        )
        order by
          public.archive_reference_scene_id(asset.crop_data),
          public.archive_reference_cut_number(asset.crop_data, asset.cut_no),
          asset.sort_order,
          asset.created_at,
          asset.id
      ),
      '[]'::jsonb
    )
    into v_order_results
  from public.project_reference_assets as asset
  where asset.project_id = p_project_id
    and public.is_orderable_archive_reference_asset(
      asset.asset_type,
      asset.mime_type,
      asset.filename,
      asset.group_id
    )
    and (
      (
        public.archive_reference_scene_id(asset.crop_data) is not distinct from v_previous_scene_id
        and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from v_previous_cut_number
      )
      or (
        public.archive_reference_scene_id(asset.crop_data) is not distinct from v_next_scene_id
        and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from p_cut_number
      )
    );

  return jsonb_build_object('ok', true, 'asset', v_asset_result, 'orders', v_order_results);
end;
$$;

create or replace function public.archive_reorder_reference_assets(
  p_project_id uuid,
  p_scene_id uuid,
  p_cut_number integer,
  p_ordered_asset_ids uuid[],
  p_expected_updated_ats timestamptz[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
set row_security = off
as $$
declare
  v_scene_id text := case when p_scene_id is null then null else p_scene_id::text end;
  v_scene_cut_count integer;
  v_current_ids uuid[];
  v_requested_ids uuid[];
  v_order_results jsonb;
begin
  if coalesce(cardinality(p_ordered_asset_ids), 0) < 1
    or cardinality(p_ordered_asset_ids) > 500
    or array_position(p_ordered_asset_ids, null) is not null then
    raise exception '순서를 저장할 이미지 목록이 올바르지 않습니다.' using errcode = '22023';
  end if;
  if cardinality(p_expected_updated_ats) is distinct from cardinality(p_ordered_asset_ids)
    or array_position(p_expected_updated_ats, null) is not null then
    raise exception '각 이미지의 저장 버전이 필요합니다.' using errcode = '22023';
  end if;
  select array_agg(id order by id)
    into v_requested_ids
  from (select distinct unnest(p_ordered_asset_ids) as id) as requested;
  if cardinality(v_requested_ids) <> cardinality(p_ordered_asset_ids) then
    raise exception '같은 이미지 ID가 순서 목록에 중복되어 있습니다.' using errcode = '22023';
  end if;
  if p_cut_number is not null and (p_cut_number < 1 or p_scene_id is null) then
    raise exception '컷 순서 범위가 올바르지 않습니다.' using errcode = '22023';
  end if;

  if p_scene_id is not null then
    select scene.cut_count
      into v_scene_cut_count
    from public.project_scene_items as scene
    where scene.id = p_scene_id
      and scene.project_id = p_project_id::text
    for share;
    if not found then
      raise exception '순서를 바꿀 씬을 찾을 수 없습니다.' using errcode = '22023';
    end if;
    if coalesce(v_scene_cut_count, 0) > 0
      and p_cut_number is not null
      and p_cut_number > v_scene_cut_count then
      raise exception '순서를 바꿀 컷 범위가 올바르지 않습니다.' using errcode = '22023';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'archive-group:' || p_project_id::text || ':' || coalesce(v_scene_id, 'unassigned') || ':' || coalesce(p_cut_number::text, 'unassigned'),
    0
  ));

  perform 1
  from public.project_reference_assets as asset
  where asset.project_id = p_project_id
    and public.is_orderable_archive_reference_asset(
      asset.asset_type,
      asset.mime_type,
      asset.filename,
      asset.group_id
    )
    and public.archive_reference_scene_id(asset.crop_data) is not distinct from v_scene_id
    and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from p_cut_number
  order by asset.id
  for update;

  select array_agg(asset.id order by asset.id)
    into v_current_ids
  from public.project_reference_assets as asset
  where asset.project_id = p_project_id
    and public.is_orderable_archive_reference_asset(
      asset.asset_type,
      asset.mime_type,
      asset.filename,
      asset.group_id
    )
    and public.archive_reference_scene_id(asset.crop_data) is not distinct from v_scene_id
    and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from p_cut_number;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', asset.id,
          'sortOrder', asset.sort_order,
          'updatedAt', asset.updated_at
        )
        order by asset.sort_order, asset.created_at, asset.id
      ),
      '[]'::jsonb
    )
    into v_order_results
  from public.project_reference_assets as asset
  where asset.project_id = p_project_id
    and public.is_orderable_archive_reference_asset(
      asset.asset_type,
      asset.mime_type,
      asset.filename,
      asset.group_id
    )
    and public.archive_reference_scene_id(asset.crop_data) is not distinct from v_scene_id
    and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from p_cut_number;

  if v_current_ids is distinct from v_requested_ids then
    return jsonb_build_object(
      'ok', false,
      'code', 'GROUP_CHANGED',
      'orders', v_order_results
    );
  end if;

  if exists (
    select 1
    from unnest(p_ordered_asset_ids, p_expected_updated_ats)
      as expected(id, expected_updated_at)
    join public.project_reference_assets as asset
      on asset.id = expected.id
      and asset.project_id = p_project_id
    where asset.updated_at is distinct from expected.expected_updated_at
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'STALE_GROUP',
      'orders', v_order_results
    );
  end if;

  with desired as (
    select id, ordinality::integer as next_order
    from unnest(p_ordered_asset_ids) with ordinality as requested(id, ordinality)
  )
  update public.project_reference_assets as asset
  set sort_order = desired.next_order
  from desired
  where asset.id = desired.id
    and asset.project_id = p_project_id
    and asset.sort_order is distinct from desired.next_order;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', asset.id,
          'sortOrder', asset.sort_order,
          'updatedAt', asset.updated_at
        )
        order by asset.sort_order, asset.created_at, asset.id
      ),
      '[]'::jsonb
    )
    into v_order_results
  from public.project_reference_assets as asset
  where asset.project_id = p_project_id
    and public.is_orderable_archive_reference_asset(
      asset.asset_type,
      asset.mime_type,
      asset.filename,
      asset.group_id
    )
    and public.archive_reference_scene_id(asset.crop_data) is not distinct from v_scene_id
    and public.archive_reference_cut_number(asset.crop_data, asset.cut_no) is not distinct from p_cut_number;

  return jsonb_build_object('ok', true, 'orders', v_order_results);
end;
$$;

revoke all on function public.archive_reference_scene_id(jsonb) from public, anon, authenticated;
revoke all on function public.archive_reference_cut_number(jsonb, text) from public, anon, authenticated;
revoke all on function public.is_orderable_archive_reference_asset(text, text, text, text) from public, anon, authenticated;
revoke all on function public.archive_move_reference_asset_scene_cut(uuid, uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.archive_reorder_reference_assets(uuid, uuid, integer, uuid[], timestamptz[]) from public, anon, authenticated;

grant execute on function public.archive_reference_scene_id(jsonb) to service_role;
grant execute on function public.archive_reference_cut_number(jsonb, text) to service_role;
grant execute on function public.is_orderable_archive_reference_asset(text, text, text, text) to service_role;
grant execute on function public.archive_move_reference_asset_scene_cut(uuid, uuid, uuid, integer, timestamptz) to service_role;
grant execute on function public.archive_reorder_reference_assets(uuid, uuid, integer, uuid[], timestamptz[]) to service_role;

commit;
