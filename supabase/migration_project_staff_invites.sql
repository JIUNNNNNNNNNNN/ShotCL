-- 프로젝트마다 하나의 재사용 가능한 일반 스탭 초대 링크를 보관합니다.
-- URL의 원본 token은 저장하지 않고 SHA-256 hash만 저장하며,
-- 생성·폐기·참여는 service-role 서버 API가 아래 RPC를 통해 원자적으로 처리합니다.

begin;

create extension if not exists pgcrypto;

-- 이 기능은 기존 프로젝트 공유 세션 구조 위에서 동작합니다. 누락된 환경에서
-- 함수 생성만 성공한 뒤 첫 호출 때 실패하지 않도록 migration 단계에서 명확히 중단합니다.
do $invite_prerequisite_check$
begin
  if to_regclass('public.projects') is null then
    raise exception 'public.projects table is required' using errcode = '42P01';
  end if;
  if to_regclass('public.project_access_sessions') is null then
    raise exception 'public.project_access_sessions table is required' using errcode = '42P01';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.projects'::regclass
      and attname = 'share_enabled'
      and not attisdropped
  ) then
    raise exception 'public.projects.share_enabled column is required' using errcode = '42703';
  end if;
end;
$invite_prerequisite_check$;

create table if not exists public.project_staff_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  token_hash text not null unique,
  created_by_session_hash text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint project_staff_invites_token_hash_check
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint project_staff_invites_creator_hash_check
    check (created_by_session_hash ~ '^[0-9a-f]{64}$')
);

comment on table public.project_staff_invites is
'Server-only reusable invitation records for general Staff project access';

comment on column public.project_staff_invites.token_hash is
'SHA-256 hex digest of the opaque URL token. The raw token is never stored.';

create unique index if not exists project_staff_invites_one_active_per_project_uidx
  on public.project_staff_invites (project_id)
  where revoked_at is null;

create index if not exists project_staff_invites_project_created_idx
  on public.project_staff_invites (project_id, created_at desc);

alter table public.project_staff_invites enable row level security;

-- 브라우저 client는 invite metadata를 직접 읽거나 변경할 수 없습니다.
revoke all on table public.project_staff_invites from public, anon, authenticated;
grant select, insert, update on public.project_staff_invites to service_role;

create or replace function public.ensure_project_staff_invite(
  p_project_id uuid,
  p_creator_session_hash text,
  p_candidate_invite_id uuid,
  p_candidate_token_hash text,
  p_rotate boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_invite public.project_staff_invites%rowtype;
begin
  if p_candidate_invite_id is null
    or p_creator_session_hash is null
    or p_creator_session_hash !~ '^[0-9a-f]{64}$'
    or p_candidate_token_hash is null
    or p_candidate_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid invite input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-staff-invite:' || p_project_id::text, 0)
  );

  -- API의 권한 검사와 별개로 DB transaction 안에서도 현재 Key staff session을 검증합니다.
  if not exists (
    select 1
    from public.project_access_sessions as session
    join public.projects as project on project.id = session.project_id
    where session.browser_token_hash = p_creator_session_hash
      and session.project_id = p_project_id
      and session.role::text = 'admin'
      and session.expires_at > now()
      and project.share_enabled = true
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
    created_by_session_hash
  )
  values (
    p_candidate_invite_id,
    p_project_id,
    p_candidate_token_hash,
    p_creator_session_hash
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

create or replace function public.revoke_project_staff_invite(
  p_project_id uuid,
  p_creator_session_hash text
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_revoked_count integer;
begin
  if p_creator_session_hash is null
    or p_creator_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid session hash' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-staff-invite:' || p_project_id::text, 0)
  );

  if not exists (
    select 1
    from public.project_access_sessions as session
    join public.projects as project on project.id = session.project_id
    where session.browser_token_hash = p_creator_session_hash
      and session.project_id = p_project_id
      and session.role::text = 'admin'
      and session.expires_at > now()
      and project.share_enabled = true
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

create or replace function public.redeem_project_staff_invite(
  p_token_hash text,
  p_browser_session_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_project_id uuid;
  v_project_name text;
  v_existing_role text;
  v_existing_expires_at timestamptz;
  v_had_session boolean := false;
begin
  if p_token_hash is null
    or p_token_hash !~ '^[0-9a-f]{64}$'
    or p_browser_session_hash is null
    or p_browser_session_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  -- 먼저 token이 가리키는 프로젝트만 찾고, 프로젝트 단위 lock 뒤 active 상태를 다시 검사합니다.
  select invite.project_id
    into v_project_id
  from public.project_staff_invites as invite
  where invite.token_hash = p_token_hash
  limit 1;

  if not found then
    return null;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-staff-invite:' || v_project_id::text, 0)
  );

  select invite.project_id, project.name
    into v_project_id, v_project_name
  from public.project_staff_invites as invite
  join public.projects as project on project.id = invite.project_id
  where invite.token_hash = p_token_hash
    and invite.revoked_at is null
    and project.share_enabled = true
  for update of invite;

  if not found then
    return null;
  end if;

  select session.role::text, session.expires_at
    into v_existing_role, v_existing_expires_at
  from public.project_access_sessions as session
  where session.browser_token_hash = p_browser_session_hash
    and session.project_id = v_project_id
  for update;

  v_had_session := found;

  if v_had_session and v_existing_expires_at > now() and v_existing_role = 'admin' then
    -- 일반 Staff 초대 링크가 Key staff 권한의 만료까지 연장하는 수단이 되지 않게 합니다.
    return jsonb_build_object(
      'projectId', v_project_id,
      'projectName', v_project_name,
      'role', v_existing_role,
      'alreadyMember', true
    );
  end if;

  if v_had_session and v_existing_expires_at > now() then
    -- 유효한 일반 Staff 권한은 유지하며 초대 링크 재사용 시 접근 기간만 갱신합니다.
    update public.project_access_sessions
    set expires_at = greatest(expires_at, now() + interval '30 days')
    where browser_token_hash = p_browser_session_hash
      and project_id = v_project_id;

    return jsonb_build_object(
      'projectId', v_project_id,
      'projectName', v_project_name,
      'role', v_existing_role,
      'alreadyMember', true
    );
  end if;

  if v_had_session then
    -- 만료된 access row는 이전 고권한을 되살리지 않고 일반 Staff로 다시 참여시킵니다.
    update public.project_access_sessions
    set role = 'progress',
        joined_at = now(),
        expires_at = now() + interval '30 days'
    where browser_token_hash = p_browser_session_hash
      and project_id = v_project_id;
  else
    insert into public.project_access_sessions (
      browser_token_hash,
      project_id,
      role,
      joined_at,
      expires_at
    )
    values (
      p_browser_session_hash,
      v_project_id,
      'progress',
      now(),
      now() + interval '30 days'
    )
    on conflict (browser_token_hash, project_id) do nothing;

    if not found then
      -- 기존 password Join과 동시에 첫 참여가 발생해도 PK 충돌을 사용자 오류로 만들지 않습니다.
      select session.role::text, session.expires_at
        into v_existing_role, v_existing_expires_at
      from public.project_access_sessions as session
      where session.browser_token_hash = p_browser_session_hash
        and session.project_id = v_project_id
      for update;

      if v_existing_role = 'admin' and v_existing_expires_at > now() then
        return jsonb_build_object(
          'projectId', v_project_id,
          'projectName', v_project_name,
          'role', v_existing_role,
          'alreadyMember', true
        );
      end if;

      update public.project_access_sessions
      set role = 'progress',
          joined_at = case when v_existing_expires_at > now() then joined_at else now() end,
          expires_at = greatest(expires_at, now() + interval '30 days')
      where browser_token_hash = p_browser_session_hash
        and project_id = v_project_id;

      return jsonb_build_object(
        'projectId', v_project_id,
        'projectName', v_project_name,
        'role', 'progress',
        'alreadyMember', v_existing_expires_at > now()
      );
    end if;
  end if;

  return jsonb_build_object(
    'projectId', v_project_id,
    'projectName', v_project_name,
    'role', 'progress',
    'alreadyMember', false
  );
end;
$$;

revoke all on function public.ensure_project_staff_invite(uuid, text, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.revoke_project_staff_invite(uuid, text)
  from public, anon, authenticated;
revoke all on function public.redeem_project_staff_invite(text, text)
  from public, anon, authenticated;

grant execute on function public.ensure_project_staff_invite(uuid, text, uuid, text, boolean)
  to service_role;
grant execute on function public.revoke_project_staff_invite(uuid, text)
  to service_role;
grant execute on function public.redeem_project_staff_invite(text, text)
  to service_role;

commit;
