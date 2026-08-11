-- Server-verified Google account sessions and editor eligibility.
-- SHOTCL_EDITOR_GOOGLE_EMAILS remains server-only; the API synchronizes only eligible users here.

begin;

create table if not exists public.shotcl_editor_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  synced_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '75 minutes'),
  constraint shotcl_editor_accounts_email_normalized_check
    check (email = lower(btrim(email)) and length(email) > 3)
);

alter table public.shotcl_editor_accounts
  add column if not exists expires_at timestamptz not null
  default (now() + interval '75 minutes');

create table if not exists public.shotcl_account_sessions (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  provider text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint shotcl_account_sessions_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint shotcl_account_sessions_email_normalized_check
    check (email = lower(btrim(email)) and length(email) > 3),
  constraint shotcl_account_sessions_google_provider_check
    check (provider = 'google')
);

create index if not exists shotcl_account_sessions_user_expiry_idx
  on public.shotcl_account_sessions (user_id, expires_at desc);

create index if not exists shotcl_account_sessions_expiry_idx
  on public.shotcl_account_sessions (expires_at);

alter table public.shotcl_editor_accounts enable row level security;
alter table public.shotcl_account_sessions enable row level security;

revoke all on table public.shotcl_editor_accounts from public, anon, authenticated;
revoke all on table public.shotcl_account_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.shotcl_editor_accounts to service_role;
grant select, insert, update, delete on public.shotcl_account_sessions to service_role;

-- Account cookie는 로그인/refresh sync마다 회전합니다. 이전 hash 삭제와 새 hash
-- insert를 한 transaction에 묶어 계정 전환·로그아웃 경쟁에서도 한 token만 남깁니다.
create or replace function public.rotate_shotcl_account_session(
  p_previous_token_hash text,
  p_new_token_hash text,
  p_user_id uuid,
  p_email text,
  p_provider text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_new_token_hash is null
    or p_new_token_hash !~ '^[0-9a-f]{64}$'
    or (p_previous_token_hash is not null and p_previous_token_hash !~ '^[0-9a-f]{64}$')
    or p_user_id is null
    or p_email is null
    or p_email <> lower(btrim(p_email))
    or p_provider <> 'google'
    or p_expires_at <= now() then
    raise exception 'invalid account session input' using errcode = '22023';
  end if;

  if p_previous_token_hash is not null then
    delete from public.shotcl_account_sessions
    where token_hash = p_previous_token_hash;
  end if;

  insert into public.shotcl_account_sessions (
    token_hash,
    user_id,
    email,
    provider,
    expires_at
  ) values (
    p_new_token_hash,
    p_user_id,
    p_email,
    p_provider,
    p_expires_at
  );
end;
$$;

revoke all on function public.rotate_shotcl_account_session(text, text, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rotate_shotcl_account_session(text, text, uuid, text, text, timestamptz)
  to service_role;

create or replace function public.is_shotcl_editor()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.shotcl_editor_accounts as editor
      where editor.user_id = auth.uid()
        and editor.expires_at > now()
    );
$$;

revoke all on function public.is_shotcl_editor() from public, anon;
grant execute on function public.is_shotcl_editor() to authenticated, service_role;

-- Authenticated Google Staff can be linked without ever downgrading an existing admin.
create or replace function public.link_shotcl_account_project_membership(
  p_project_id uuid,
  p_user_id uuid
)
returns public.project_role
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_role public.project_role;
begin
  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, p_user_id, 'crew')
  on conflict (project_id, user_id) do update
    set role = case
      when public.project_members.role = 'admin' then 'admin'::public.project_role
      else 'crew'::public.project_role
    end
  returning role into v_role;
  return v_role;
end;
$$;

revoke all on function public.link_shotcl_account_project_membership(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.link_shotcl_account_project_membership(uuid, uuid)
  to service_role;

-- 기존 reusable invite table을 account owner/admin도 관리할 수 있게 점진 확장합니다.
alter table if exists public.project_staff_invites
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null;
alter table if exists public.project_staff_invites
  alter column created_by_session_hash drop not null;

do $account_invite_creator_check$
begin
  if to_regclass('public.project_staff_invites') is not null
    and not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.project_staff_invites'::regclass
        and conname = 'project_staff_invites_creator_present_check'
    ) then
    alter table public.project_staff_invites
      add constraint project_staff_invites_creator_present_check
      check (created_by_session_hash is not null or created_by_user_id is not null);
  end if;
end;
$account_invite_creator_check$;

create or replace function public.ensure_project_staff_invite_for_account(
  p_project_id uuid,
  p_user_id uuid,
  p_candidate_invite_id uuid,
  p_candidate_token_hash text,
  p_rotate boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_invite public.project_staff_invites%rowtype;
begin
  if p_project_id is null
    or p_user_id is null
    or p_candidate_invite_id is null
    or p_candidate_token_hash is null
    or p_candidate_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid invite input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-staff-invite:' || p_project_id::text, 0)
  );

  if not exists (
    select 1
    from public.projects as project
    join public.shotcl_editor_accounts as editor
      on editor.user_id = p_user_id
     and editor.expires_at > now()
    left join public.project_members as member
      on member.project_id = project.id
     and member.user_id = p_user_id
    where project.id = p_project_id
      and (project.created_by = p_user_id or member.role::text = 'admin')
  ) then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  select invite.*
    into v_invite
  from public.project_staff_invites as invite
  where invite.project_id = p_project_id
    and invite.revoked_at is null
  for update;

  if found and not p_rotate then
    return jsonb_build_object(
      'inviteId', v_invite.id,
      'projectId', v_invite.project_id,
      'tokenHash', v_invite.token_hash,
      'createdAt', v_invite.created_at,
      'created', false
    );
  end if;

  if found then
    update public.project_staff_invites
    set revoked_at = now()
    where id = v_invite.id;
  end if;

  insert into public.project_staff_invites (
    id,
    project_id,
    token_hash,
    created_by_session_hash,
    created_by_user_id
  ) values (
    p_candidate_invite_id,
    p_project_id,
    p_candidate_token_hash,
    null,
    p_user_id
  )
  returning * into v_invite;

  return jsonb_build_object(
    'inviteId', v_invite.id,
    'projectId', v_invite.project_id,
    'tokenHash', v_invite.token_hash,
    'createdAt', v_invite.created_at,
    'created', true
  );
end;
$$;

create or replace function public.revoke_project_staff_invite_for_account(
  p_project_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_revoked_count integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-staff-invite:' || p_project_id::text, 0)
  );

  if not exists (
    select 1
    from public.projects as project
    join public.shotcl_editor_accounts as editor
      on editor.user_id = p_user_id
     and editor.expires_at > now()
    left join public.project_members as member
      on member.project_id = project.id
     and member.user_id = p_user_id
    where project.id = p_project_id
      and (project.created_by = p_user_id or member.role::text = 'admin')
  ) then
    raise exception 'admin access required' using errcode = '42501';
  end if;

  update public.project_staff_invites
  set revoked_at = now()
  where project_id = p_project_id
    and revoked_at is null;

  get diagnostics v_revoked_count = row_count;
  return v_revoked_count > 0;
end;
$$;

revoke all on function public.ensure_project_staff_invite_for_account(uuid, uuid, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.revoke_project_staff_invite_for_account(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_project_staff_invite_for_account(uuid, uuid, uuid, text, boolean)
  to service_role;
grant execute on function public.revoke_project_staff_invite_for_account(uuid, uuid)
  to service_role;

-- Restore the canonical member read policy if an early MVP owner-only script replaced it.
drop policy if exists "projects_select_members" on public.projects;
create policy "projects_select_members"
on public.projects for select
to authenticated
using (public.is_project_member(id));

drop policy if exists "projects_insert_authenticated" on public.projects;
create policy "projects_insert_authenticated"
on public.projects for insert
to authenticated
with check (public.is_shotcl_editor() and created_by = auth.uid());

drop policy if exists "projects_update_own_authenticated" on public.projects;
drop policy if exists "projects_update_admins" on public.projects;
create policy "projects_update_admins"
on public.projects for update
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(id))
with check (public.is_shotcl_editor() and public.is_project_admin(id));

drop policy if exists "projects_delete_admins" on public.projects;
create policy "projects_delete_admins"
on public.projects for delete
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(id));

drop policy if exists "project_members_manage_admins" on public.project_members;
create policy "project_members_manage_admins"
on public.project_members for all
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id))
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "storyboard_files_insert_admins" on public.storyboard_files;
create policy "storyboard_files_insert_admins"
on public.storyboard_files for insert
to authenticated
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "storyboard_files_delete_admins" on public.storyboard_files;
create policy "storyboard_files_delete_admins"
on public.storyboard_files for delete
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "daily_plans_insert_admins" on public.daily_plans;
create policy "daily_plans_insert_admins"
on public.daily_plans for insert
to authenticated
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "daily_plans_update_admins" on public.daily_plans;
create policy "daily_plans_update_admins"
on public.daily_plans for update
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id))
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "daily_plans_delete_admins" on public.daily_plans;
create policy "daily_plans_delete_admins"
on public.daily_plans for delete
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "daily_plan_shots_insert_admins" on public.daily_plan_shots;
create policy "daily_plan_shots_insert_admins"
on public.daily_plan_shots for insert
to authenticated
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "daily_plan_shots_update_admins" on public.daily_plan_shots;
create policy "daily_plan_shots_update_admins"
on public.daily_plan_shots for update
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id))
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "daily_plan_shots_delete_admins" on public.daily_plan_shots;
create policy "daily_plan_shots_delete_admins"
on public.daily_plan_shots for delete
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "analysis_runs_insert_admins" on public.analysis_runs;
create policy "analysis_runs_insert_admins"
on public.analysis_runs for insert
to authenticated
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "analysis_runs_update_admins" on public.analysis_runs;
create policy "analysis_runs_update_admins"
on public.analysis_runs for update
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id))
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "analysis_runs_delete_admins" on public.analysis_runs;
create policy "analysis_runs_delete_admins"
on public.analysis_runs for delete
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "analysis_run_items_insert_admins" on public.analysis_run_items;
create policy "analysis_run_items_insert_admins"
on public.analysis_run_items for insert
to authenticated
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "analysis_run_items_update_admins" on public.analysis_run_items;
create policy "analysis_run_items_update_admins"
on public.analysis_run_items for update
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id))
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "analysis_run_items_delete_admins" on public.analysis_run_items;
create policy "analysis_run_items_delete_admins"
on public.analysis_run_items for delete
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "shots_insert_admins" on public.shots;
create policy "shots_insert_admins"
on public.shots for insert
to authenticated
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "shots_update_members" on public.shots;
drop policy if exists "shots_update_editor_admins" on public.shots;
create policy "shots_update_editor_admins"
on public.shots for update
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id))
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "shots_delete_admins" on public.shots;
create policy "shots_delete_admins"
on public.shots for delete
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "project_basic_info_insert_admins" on public.project_basic_info;
create policy "project_basic_info_insert_admins"
on public.project_basic_info for insert
to authenticated
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "project_basic_info_update_admins" on public.project_basic_info;
create policy "project_basic_info_update_admins"
on public.project_basic_info for update
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id))
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "project_basic_info_delete_admins" on public.project_basic_info;
create policy "project_basic_info_delete_admins"
on public.project_basic_info for delete
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "project_calendar_events_insert_admins" on public.project_calendar_events;
create policy "project_calendar_events_insert_admins"
on public.project_calendar_events for insert
to authenticated
with check (
  public.is_shotcl_editor()
  and public.is_project_admin(project_id)
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists "project_calendar_events_update_admins" on public.project_calendar_events;
create policy "project_calendar_events_update_admins"
on public.project_calendar_events for update
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id))
with check (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "project_calendar_events_delete_admins" on public.project_calendar_events;
create policy "project_calendar_events_delete_admins"
on public.project_calendar_events for delete
to authenticated
using (public.is_shotcl_editor() and public.is_project_admin(project_id));

drop policy if exists "storyboards_insert_admins" on storage.objects;
create policy "storyboards_insert_admins"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'storyboards'
  and public.is_shotcl_editor()
  and public.is_project_admin(((storage.foldername(name))[2])::uuid)
);

drop policy if exists "storyboards_delete_admins" on storage.objects;
create policy "storyboards_delete_admins"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'storyboards'
  and public.is_shotcl_editor()
  and public.is_project_admin(((storage.foldername(name))[2])::uuid)
);

-- This table was initially created without RLS. Keep it behind the service-role APIs.
alter table if exists public.shot_diagrams enable row level security;
revoke all on table public.shot_diagrams from public, anon, authenticated;
grant select, insert, update, delete on public.shot_diagrams to service_role;

commit;
