-- project_basic_info.main_staff를 고정 직책 object에서 staff-id 기반 array로 전환합니다.
-- 기존 감독/조감독/제작 데이터는 배열 row로 변환하며 삭제하지 않습니다.

alter table public.project_basic_info
drop constraint if exists project_basic_info_main_staff_object_check;

alter table public.project_basic_info
alter column main_staff set default '[]'::jsonb;

update public.project_basic_info as basic_info
set main_staff = (
  select coalesce(jsonb_agg(staff.member order by staff.sort_order), '[]'::jsonb)
  from (
    values
      (
        0,
        jsonb_build_object(
          'id', coalesce(
            nullif(basic_info.main_staff #>> '{director,id}', ''),
            'legacy-director'
          ),
          'role', coalesce(
            nullif(basic_info.main_staff #>> '{director,role}', ''),
            nullif(basic_info.main_staff #>> '{director,title}', ''),
            '감독'
          ),
          'name', coalesce(
            nullif(basic_info.main_staff #>> '{director,name}', ''),
            case
              when jsonb_typeof(basic_info.main_staff -> 'director') = 'string'
                then nullif(basic_info.main_staff ->> 'director', '')
              else null
            end,
            nullif(basic_info.main_staff ->> 'directorName', ''),
            ''
          ),
          'phone', coalesce(
            nullif(basic_info.main_staff #>> '{director,phone}', ''),
            nullif(basic_info.main_staff ->> 'directorPhone', ''),
            ''
          ),
          'includeInDailyPlan', case
            when lower(coalesce(basic_info.main_staff #>> '{director,includeInDailyPlan}', 'true')) = 'false'
              then false
            else true
          end,
          'sortOrder', 0
        )
      ),
      (
        1,
        jsonb_build_object(
          'id', coalesce(
            nullif(basic_info.main_staff #>> '{assistantDirector,id}', ''),
            'legacy-assistant-director'
          ),
          'role', coalesce(
            nullif(basic_info.main_staff #>> '{assistantDirector,role}', ''),
            nullif(basic_info.main_staff #>> '{assistantDirector,title}', ''),
            '조감독'
          ),
          'name', coalesce(
            nullif(basic_info.main_staff #>> '{assistantDirector,name}', ''),
            case
              when jsonb_typeof(basic_info.main_staff -> 'assistantDirector') = 'string'
                then nullif(basic_info.main_staff ->> 'assistantDirector', '')
              else null
            end,
            nullif(basic_info.main_staff ->> 'assistantDirectorName', ''),
            nullif(basic_info.main_staff ->> 'adName', ''),
            ''
          ),
          'phone', coalesce(
            nullif(basic_info.main_staff #>> '{assistantDirector,phone}', ''),
            nullif(basic_info.main_staff ->> 'assistantDirectorPhone', ''),
            nullif(basic_info.main_staff ->> 'adPhone', ''),
            ''
          ),
          'includeInDailyPlan', case
            when lower(coalesce(basic_info.main_staff #>> '{assistantDirector,includeInDailyPlan}', 'true')) = 'false'
              then false
            else true
          end,
          'sortOrder', 1
        )
      ),
      (
        2,
        jsonb_build_object(
          'id', coalesce(
            nullif(basic_info.main_staff #>> '{producer,id}', ''),
            'legacy-producer'
          ),
          'role', coalesce(
            nullif(basic_info.main_staff #>> '{producer,role}', ''),
            nullif(basic_info.main_staff #>> '{producer,title}', ''),
            '제작'
          ),
          'name', coalesce(
            nullif(basic_info.main_staff #>> '{producer,name}', ''),
            case
              when jsonb_typeof(basic_info.main_staff -> 'producer') = 'string'
                then nullif(basic_info.main_staff ->> 'producer', '')
              else null
            end,
            nullif(basic_info.main_staff ->> 'producerName', ''),
            nullif(basic_info.main_staff ->> 'productionName', ''),
            ''
          ),
          'phone', coalesce(
            nullif(basic_info.main_staff #>> '{producer,phone}', ''),
            nullif(basic_info.main_staff ->> 'producerPhone', ''),
            nullif(basic_info.main_staff ->> 'productionPhone', ''),
            ''
          ),
          'includeInDailyPlan', case
            when lower(coalesce(basic_info.main_staff #>> '{producer,includeInDailyPlan}', 'true')) = 'false'
              then false
            else true
          end,
          'sortOrder', 2
        )
      )
  ) as staff(sort_order, member)
  where coalesce(staff.member ->> 'name', '') <> ''
     or coalesce(staff.member ->> 'phone', '') <> ''
)
where jsonb_typeof(basic_info.main_staff) = 'object';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'project_basic_info_main_staff_array_check'
      and conrelid = 'public.project_basic_info'::regclass
  ) then
    alter table public.project_basic_info
    add constraint project_basic_info_main_staff_array_check
    check (jsonb_typeof(main_staff) = 'array') not valid;
  end if;
end
$$;

alter table public.project_basic_info
validate constraint project_basic_info_main_staff_array_check;

comment on column public.project_basic_info.main_staff is
'JSON array of staff rows: id, role, name, phone, includeInDailyPlan, and sortOrder';
