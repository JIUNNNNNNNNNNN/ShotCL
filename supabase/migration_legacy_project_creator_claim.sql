-- One-time creator recovery for legacy projects created before Google owner
-- persistence. Apply after migration_project_permanent_deletion.sql.
--
-- This does not infer ownership from a current admin role. It accepts only the
-- original, still-active browser grant written in the same two-second creation
-- window as the project and its credential row.

begin;

do $legacy_project_creator_claim_prerequisites$
begin
  if to_regclass('public.projects') is null
    or to_regclass('public.project_members') is null
    or to_regclass('public.project_access_credentials') is null
    or to_regclass('public.project_access_sessions') is null
    or to_regclass('public.shotcl_editor_accounts') is null then
    raise exception 'legacy creator claim prerequisites are missing' using errcode = '42P01';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.projects'::regclass
      and attname = 'deletion_started_at'
      and not attisdropped
  ) then
    raise exception 'migration_project_permanent_deletion.sql must be applied first'
      using errcode = '42703';
  end if;
end;
$legacy_project_creator_claim_prerequisites$;

create table if not exists public.legacy_project_creator_claims (
  project_id uuid primary key references public.projects(id) on delete cascade,
  creator_user_id uuid not null references auth.users(id) on delete cascade,
  legacy_session_hash text not null,
  project_created_at timestamptz not null,
  credential_created_at timestamptz not null,
  session_joined_at timestamptz not null,
  claim_transaction_id bigint not null default txid_current(),
  claimed_at timestamptz not null default now(),
  constraint legacy_project_creator_claims_session_hash_check
    check (legacy_session_hash ~ '^[0-9a-f]{64}$')
);

alter table public.legacy_project_creator_claims enable row level security;
-- Even the application's ubiquitous service client must not manufacture an
-- authorization receipt. Only this migration's SECURITY DEFINER function
-- owner can read or write the table.
revoke all on table public.legacy_project_creator_claims
  from public, anon, authenticated, service_role;

comment on table public.legacy_project_creator_claims is
'Server-only immutable audit receipts for creator recovery proven by an exact creation-origin browser grant.';

-- Preserve the permanent-deletion migration's immutable creator boundary. The
-- only additional transition is NULL -> the exact UUID already authorized by
-- a server-only creation receipt in the same transaction.
create or replace function public.enforce_immutable_project_creator()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.created_by is distinct from old.created_by then
    if new.created_by is null
      and old.created_by is not null
      and pg_trigger_depth() > 1 then
      return new;
    end if;
    if old.created_by is null
      and new.created_by is not null
      and exists (
        select 1
        from public.legacy_project_creator_claims as claim
        where claim.project_id = new.id
          and claim.creator_user_id = new.created_by
          and claim.claim_transaction_id = txid_current()
      ) then
      return new;
    end if;
    raise exception 'project creator is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.claim_legacy_project_creator(
  p_project_id uuid,
  p_creator_user_id uuid,
  p_legacy_session_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_project public.projects%rowtype;
  v_credential public.project_access_credentials%rowtype;
  v_session public.project_access_sessions%rowtype;
  v_window_admin_count integer;
  v_existing_claim public.legacy_project_creator_claims%rowtype;
begin
  if p_project_id is null
    or p_creator_user_id is null
    or p_legacy_session_hash is null
    or p_legacy_session_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid legacy creator claim input' using errcode = '22023';
  end if;

  -- Serialize with permanent deletion and every guarded project write.
  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-permanent-deletion:' || p_project_id::text, 0)
  );

  select project.* into v_project
  from public.projects as project
  where project.id = p_project_id
  for update;
  if not found then
    return 'missing';
  end if;

  if v_project.deletion_started_at is not null
    or v_project.share_enabled is not true
    or not exists (
      select 1
      from public.shotcl_editor_accounts as editor
      where editor.user_id = p_creator_user_id
        and editor.expires_at > now()
    ) then
    return 'ineligible';
  end if;

  if v_project.created_by is not null then
    if v_project.created_by = p_creator_user_id then
      insert into public.project_members (project_id, user_id, role)
      values (p_project_id, p_creator_user_id, 'admin')
      on conflict (project_id, user_id) do update set role = 'admin';
      return 'already_creator';
    end if;
    return 'ineligible';
  end if;

  select credential.* into v_credential
  from public.project_access_credentials as credential
  where credential.project_id = p_project_id;
  if not found
    or v_credential.created_at < v_project.created_at
    or v_credential.created_at > v_project.created_at + interval '2 seconds' then
    return 'ineligible';
  end if;

  select session.* into v_session
  from public.project_access_sessions as session
  where session.project_id = p_project_id
    and session.browser_token_hash = p_legacy_session_hash
    and session.role = 'admin'
    and session.expires_at > now();
  if not found
    or v_session.joined_at < v_project.created_at
    or v_session.joined_at > v_project.created_at + interval '2 seconds'
    or v_session.joined_at < v_credential.created_at then
    return 'ineligible';
  end if;

  -- Later admin sessions do not invalidate an intact creation receipt. There
  -- must nevertheless be exactly one admin grant inside the creation window,
  -- and the current token must be that row.
  select count(*)::integer into v_window_admin_count
  from public.project_access_sessions as session
  where session.project_id = p_project_id
    and session.role = 'admin'
    and session.joined_at >= v_project.created_at
    and session.joined_at <= v_project.created_at + interval '2 seconds';
  if v_window_admin_count <> 1 then
    return 'ineligible';
  end if;

  select claim.* into v_existing_claim
  from public.legacy_project_creator_claims as claim
  where claim.project_id = p_project_id
  for update;
  if found then
    return case
      when v_existing_claim.creator_user_id = p_creator_user_id
        and v_existing_claim.legacy_session_hash = p_legacy_session_hash
      then 'already_creator'
      else 'ineligible'
    end;
  end if;

  insert into public.legacy_project_creator_claims (
    project_id,
    creator_user_id,
    legacy_session_hash,
    project_created_at,
    credential_created_at,
    session_joined_at,
    claim_transaction_id
  ) values (
    p_project_id,
    p_creator_user_id,
    p_legacy_session_hash,
    v_project.created_at,
    v_credential.created_at,
    v_session.joined_at,
    txid_current()
  );

  update public.projects
  set created_by = p_creator_user_id
  where id = p_project_id
    and created_by is null;
  if not found then
    raise exception 'legacy creator claim lost its project lock' using errcode = '40001';
  end if;

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, p_creator_user_id, 'admin')
  on conflict (project_id, user_id) do update set role = 'admin';

  return 'claimed';
end;
$$;

revoke all on function public.claim_legacy_project_creator(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_legacy_project_creator(uuid, uuid, text)
  to service_role;

commit;
