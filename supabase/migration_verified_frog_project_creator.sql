-- Operator-attested one-time creator backfill for the legacy Project
-- "하부장의 개구리". The operator verified that the exact Google account
-- below is the original creator. Apply after both
-- migration_project_permanent_deletion.sql and
-- migration_legacy_project_creator_claim.sql.
--
-- This migration is intentionally UUID-bound. The Project name and Google
-- email are secondary human-readable assertions only; neither is used to
-- discover or infer an owner.

begin;

do $verified_frog_creator_prerequisites$
begin
  if to_regclass('public.projects') is null
    or to_regclass('public.project_members') is null
    or to_regclass('public.legacy_project_creator_claims') is null
    or to_regclass('public.shotcl_editor_accounts') is null
    or to_regprocedure('public.enforce_immutable_project_creator()') is null then
    raise exception 'verified creator backfill prerequisites are missing'
      using errcode = '42P01';
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

  if not exists (
    select 1
    from pg_catalog.pg_trigger as creator_trigger
    where creator_trigger.tgrelid = 'public.projects'::regclass
      and creator_trigger.tgname = 'projects_immutable_creator'
      and creator_trigger.tgfoid = 'public.enforce_immutable_project_creator()'::regprocedure
      and creator_trigger.tgenabled in ('O', 'A')
      and not creator_trigger.tgisinternal
  ) then
    raise exception 'enabled immutable Project creator trigger is required'
      using errcode = '55000';
  end if;
end;
$verified_frog_creator_prerequisites$;

-- A dedicated immutable receipt records the external operator attestation.
-- Literal CHECK constraints make it impossible to reuse this table for any
-- other Project or Google account.
create table if not exists public.verified_frog_project_creator_backfill_audit (
  project_id uuid primary key references public.projects(id) on delete cascade,
  creator_user_id uuid not null references auth.users(id) on delete cascade,
  project_name_at_backfill text not null,
  creator_email_at_backfill text not null,
  project_created_at timestamptz not null,
  previous_created_by uuid,
  claim_transaction_id bigint not null default txid_current(),
  backfilled_at timestamptz not null default now(),
  constraint verified_frog_creator_project_id_check
    check (project_id = '3f255cf2-0ef6-45d1-8802-dc405a1d91a7'::uuid),
  constraint verified_frog_creator_user_id_check
    check (creator_user_id = '6d6c435c-d485-4330-9cf2-7b03be146ec2'::uuid),
  constraint verified_frog_creator_project_name_check
    check (project_name_at_backfill = '하부장의 개구리'),
  constraint verified_frog_creator_email_check
    check (creator_email_at_backfill = 'stop7lukky@gmail.com'),
  constraint verified_frog_creator_previous_owner_check
    check (previous_created_by is null)
);

alter table public.verified_frog_project_creator_backfill_audit
  enable row level security;
revoke all on table public.verified_frog_project_creator_backfill_audit
  from public, anon, authenticated, service_role;

comment on table public.verified_frog_project_creator_backfill_audit is
'Immutable operator-attested receipt for the one verified legacy creator backfill of Project 3f255cf2-0ef6-45d1-8802-dc405a1d91a7.';

-- Keep the canonical creator immutable. A NULL -> UUID transition is accepted
-- only when either the existing creation-session proof or this exact
-- operator-attested receipt was written in the same database transaction.
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
      and (
        exists (
          select 1
          from public.legacy_project_creator_claims as claim
          where claim.project_id = new.id
            and claim.creator_user_id = new.created_by
            and claim.claim_transaction_id = txid_current()
        )
        or exists (
          select 1
          from public.verified_frog_project_creator_backfill_audit as verified
          where verified.project_id = new.id
            and verified.creator_user_id = new.created_by
            and verified.claim_transaction_id = txid_current()
        )
      ) then
      return new;
    end if;

    raise exception 'project creator is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_immutable_project_creator()
  from public, anon, authenticated, service_role;

do $verified_frog_creator_backfill$
declare
  v_project_id constant uuid := '3f255cf2-0ef6-45d1-8802-dc405a1d91a7'::uuid;
  v_creator_user_id constant uuid := '6d6c435c-d485-4330-9cf2-7b03be146ec2'::uuid;
  v_expected_project_name constant text := '하부장의 개구리';
  v_expected_creator_email constant text := 'stop7lukky@gmail.com';
  v_project public.projects%rowtype;
  v_existing_receipt public.verified_frog_project_creator_backfill_audit%rowtype;
  v_auth_email text;
  v_receipt_found boolean;
  v_updated_count integer;
begin
  -- Serialize with permanent deletion and every guarded Project write.
  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-permanent-deletion:' || v_project_id::text, 0)
  );

  select project.* into v_project
  from public.projects as project
  where project.id = v_project_id
  for update;
  if not found then
    raise exception 'verified creator target Project UUID is missing'
      using errcode = 'P0002';
  end if;

  select receipt.* into v_existing_receipt
  from public.verified_frog_project_creator_backfill_audit as receipt
  where receipt.project_id = v_project_id
  for update;
  v_receipt_found := found;

  -- A second application is a no-op only for the exact already-audited UUID
  -- pair. Every other pre-existing creator or receipt aborts the transaction.
  if v_project.created_by is not null then
    if v_project.created_by = v_creator_user_id
      and v_receipt_found
      and v_existing_receipt.creator_user_id = v_creator_user_id then
      raise notice 'verified creator backfill already applied to Project %', v_project_id;
      return;
    end if;
    raise exception 'verified creator target already has a different or unaudited creator'
      using errcode = '42501';
  end if;

  if v_receipt_found then
    raise exception 'verified creator receipt exists without its creator update'
      using errcode = '40001';
  end if;

  if v_project.name is distinct from v_expected_project_name then
    raise exception 'verified creator target name assertion failed'
      using errcode = '22023';
  end if;
  if v_project.deletion_started_at is not null then
    raise exception 'verified creator target is being permanently deleted'
      using errcode = '55000';
  end if;

  select lower(btrim(auth_user.email)) into v_auth_email
  from auth.users as auth_user
  where auth_user.id = v_creator_user_id;
  if not found or v_auth_email is distinct from v_expected_creator_email then
    raise exception 'verified creator Google identity assertion failed'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.identities as identity
    where identity.user_id = v_creator_user_id
      and identity.provider = 'google'
  ) then
    raise exception 'verified creator Google provider assertion failed'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.shotcl_editor_accounts as editor
    where editor.user_id = v_creator_user_id
      and lower(btrim(editor.email)) = v_expected_creator_email
  ) then
    raise exception 'verified creator editor-account assertion failed'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.project_members as member
    where member.project_id = v_project_id
      and member.user_id = v_creator_user_id
      and member.role::text = 'admin'
  ) then
    raise exception 'verified creator exact admin membership assertion failed'
      using errcode = '42501';
  end if;

  insert into public.verified_frog_project_creator_backfill_audit (
    project_id,
    creator_user_id,
    project_name_at_backfill,
    creator_email_at_backfill,
    project_created_at,
    previous_created_by,
    claim_transaction_id
  ) values (
    v_project_id,
    v_creator_user_id,
    v_project.name,
    v_auth_email,
    v_project.created_at,
    v_project.created_by,
    txid_current()
  );

  update public.projects
  set created_by = v_creator_user_id
  where id = v_project_id
    and name = v_expected_project_name
    and created_by is null
    and deletion_started_at is null;
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'verified creator backfill must update exactly one Project row'
      using errcode = '40001';
  end if;

  if not exists (
    select 1
    from public.projects as project
    where project.id = v_project_id
      and project.created_by = v_creator_user_id
  ) then
    raise exception 'verified creator backfill postcondition failed'
      using errcode = '40001';
  end if;
end;
$verified_frog_creator_backfill$;

commit;
