-- 프로젝트 Home의 사용자 공유 일정을 일촬표·기본정보와 분리해 저장합니다.
-- 기존 projects, project_basic_info, daily_plans 데이터는 수정하거나 삭제하지 않습니다.

begin;

create extension if not exists pgcrypto;

create table if not exists public.project_calendar_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,
  start_time time without time zone,
  end_time time without time zone,
  location text not null default '',
  color_key text not null default 'cyan',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_calendar_events_title_check
    check (char_length(btrim(title)) between 1 and 120),
  constraint project_calendar_events_location_check
    check (char_length(location) <= 120),
  constraint project_calendar_events_date_range_check
    check (start_date <= end_date),
  constraint project_calendar_events_time_pair_check
    check ((start_time is null) = (end_time is null)),
  constraint project_calendar_events_time_range_check
    check (
      start_date < end_date
      or start_time is null
      or end_time is null
      or start_time <= end_time
    ),
  constraint project_calendar_events_color_key_check
    check (color_key in ('lime', 'yellow', 'cyan', 'blue', 'magenta'))
);

comment on table public.project_calendar_events is
'Project-scoped, member-visible calendar events shown on the project Home month calendar';

comment on column public.project_calendar_events.project_id is
'Canonical projects.id foreign key. Passcode sessions use the server API; authenticated users are also protected by RLS.';

comment on column public.project_calendar_events.color_key is
'One of lime, yellow, cyan, blue, or magenta';

create index if not exists project_calendar_events_project_range_idx
  on public.project_calendar_events (project_id, start_date, end_date);

create index if not exists project_calendar_events_project_start_idx
  on public.project_calendar_events (project_id, start_date, start_time, created_at, id);

create index if not exists project_calendar_events_created_by_idx
  on public.project_calendar_events (created_by)
  where created_by is not null;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is null then
    execute $function$
      create function public.set_updated_at()
      returns trigger
      language plpgsql
      as $body$
      begin
        new.updated_at = now();
        return new;
      end;
      $body$
    $function$;
  end if;
end
$$;

drop trigger if exists project_calendar_events_set_updated_at
  on public.project_calendar_events;
create trigger project_calendar_events_set_updated_at
before update on public.project_calendar_events
for each row execute function public.set_updated_at();

create or replace function public.set_project_calendar_event_author()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  else
    -- 일정은 생성된 프로젝트 밖으로 이동할 수 없습니다.
    new.project_id = old.project_id;
    new.created_by = old.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists project_calendar_events_set_author
  on public.project_calendar_events;
create trigger project_calendar_events_set_author
before insert or update on public.project_calendar_events
for each row execute function public.set_project_calendar_event_author();

alter table public.project_calendar_events enable row level security;

drop policy if exists "project_calendar_events_select_members"
  on public.project_calendar_events;
create policy "project_calendar_events_select_members"
on public.project_calendar_events for select
to authenticated
using (public.is_project_member(project_id));

drop policy if exists "project_calendar_events_insert_admins"
  on public.project_calendar_events;
create policy "project_calendar_events_insert_admins"
on public.project_calendar_events for insert
to authenticated
with check (
  public.is_project_admin(project_id)
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists "project_calendar_events_update_admins"
  on public.project_calendar_events;
create policy "project_calendar_events_update_admins"
on public.project_calendar_events for update
to authenticated
using (public.is_project_admin(project_id))
with check (public.is_project_admin(project_id));

drop policy if exists "project_calendar_events_delete_admins"
  on public.project_calendar_events;
create policy "project_calendar_events_delete_admins"
on public.project_calendar_events for delete
to authenticated
using (public.is_project_admin(project_id));

grant select, insert, update, delete on public.project_calendar_events to authenticated;

commit;
