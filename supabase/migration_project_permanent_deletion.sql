-- Owner-only permanent project deletion.
-- Apply manually after every preceding ShotCL migration. This migration never
-- deletes existing data; it adds the lock/job/RPC boundary used by the server.

begin;

do $project_permanent_deletion_prerequisites$
begin
  if to_regclass('public.projects') is null then
    raise exception 'public.projects table is required' using errcode = '42P01';
  end if;
  if to_regclass('public.project_members') is null then
    raise exception 'public.project_members table is required' using errcode = '42P01';
  end if;
  if to_regclass('public.project_access_credentials') is null then
    raise exception 'public.project_access_credentials table is required' using errcode = '42P01';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.projects'::regclass
      and attname = 'created_by'
      and not attisdropped
  ) then
    raise exception 'public.projects.created_by is required' using errcode = '42703';
  end if;
end;
$project_permanent_deletion_prerequisites$;

alter table public.projects
  add column if not exists deletion_started_at timestamptz;

comment on column public.projects.deletion_started_at is
'Transient write lock set only while an owner-authorized permanent deletion is running.';

-- The first creator UUID is the permanent owner identity. Project edits and
-- role changes must never transfer this destructive capability.
create or replace function public.enforce_immutable_project_creator()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.created_by is distinct from old.created_by then
    -- Preserve the existing auth.users FK ON DELETE SET NULL lifecycle while
    -- rejecting every direct project edit/transfer. FK referential actions run
    -- as a nested trigger after the referenced auth row is no longer visible.
    if new.created_by is null
      and old.created_by is not null
      and pg_trigger_depth() > 1 then
      return new;
    end if;
    raise exception 'project creator is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_immutable_creator on public.projects;
create trigger projects_immutable_creator
before update of created_by on public.projects
for each row execute function public.enforce_immutable_project_creator();

-- A retry row is intentionally not FK-cascaded from projects. If a database
-- response is interrupted, the exact old UUID/owner/prefix inventory remains
-- available until the final purge transaction removes both root and job.
create table if not exists public.project_deletion_jobs (
  project_id uuid primary key,
  owner_user_id uuid not null,
  confirmation_name_hash text not null,
  storage_paths jsonb not null default '[]'::jsonb,
  storage_verified_at timestamptz,
  purge_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_deletion_jobs_name_hash_check
    check (confirmation_name_hash ~ '^[0-9a-f]{64}$'),
  constraint project_deletion_jobs_storage_paths_check
    check (jsonb_typeof(storage_paths) = 'array')
);

alter table public.project_deletion_jobs
  add column if not exists storage_verified_at timestamptz,
  add column if not exists purge_started_at timestamptz;

alter table public.project_deletion_jobs enable row level security;
revoke all on table public.project_deletion_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.project_deletion_jobs to service_role;

comment on table public.project_deletion_jobs is
'Transient, service-only retry state. Contains no project name or content and is removed in the final purge transaction.';

-- Historical Join throttles were keyed only by IP + normalized project name.
-- Adding the resolved UUID lets purge remove existing-project attempts and
-- prevents a newly-created same-name project inheriting the old 15m block.
do $scope_project_access_attempts$
begin
  if to_regclass('public.project_access_attempts') is not null then
    execute 'alter table public.project_access_attempts add column if not exists project_id uuid';
    if not exists (
      select 1
      from pg_catalog.pg_constraint as constraint_row
      join pg_catalog.pg_attribute as attribute_row
        on attribute_row.attrelid = constraint_row.conrelid
       and attribute_row.attnum = any (constraint_row.conkey)
      where constraint_row.conrelid = 'public.project_access_attempts'::regclass
        and constraint_row.contype = 'f'
        and constraint_row.confrelid = 'public.projects'::regclass
        and attribute_row.attname = 'project_id'
    ) then
      execute 'alter table public.project_access_attempts add constraint project_access_attempts_project_id_fkey foreign key (project_id) references public.projects(id) on delete cascade';
    end if;
    execute 'create index if not exists project_access_attempts_project_id_idx on public.project_access_attempts(project_id)';
  end if;
end;
$scope_project_access_attempts$;

-- Direct browser root deletion would bypass Storage cleanup. Only the
-- service-only purge RPC below may remove a project root.
drop policy if exists "projects_select_own_authenticated" on public.projects;
drop policy if exists "projects_update_own_authenticated" on public.projects;
drop policy if exists "projects_delete_admins" on public.projects;
drop policy if exists "projects_delete_own_authenticated" on public.projects;
revoke delete on table public.projects from public, anon, authenticated;

-- Once deletion begins, both RLS and every API access resolver that relies on
-- these canonical helpers lose member/admin capability immediately.
create or replace function public.is_project_member(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.project_members as member
    join public.projects as project on project.id = member.project_id
    where member.project_id = project_uuid
      and member.user_id = auth.uid()
      and project.deletion_started_at is null
  );
$$;

create or replace function public.is_project_admin(project_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.project_members as member
    join public.projects as project on project.id = member.project_id
    where member.project_id = project_uuid
      and member.user_id = auth.uid()
      and member.role = 'admin'
      and project.deletion_started_at is null
  );
$$;

-- Realtime authorization is evaluated against the changed row. Publishing the
-- projects UPDATE itself is unsafe because the lock makes the NEW project row
-- fail normal member RLS. Each minimal signal row carries its recipient UUID,
-- so its SELECT policy never depends on membership surviving until WAL delivery.
create table if not exists public.project_deletion_events (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null,
  deletion_started_at timestamptz not null,
  primary key (project_id, user_id)
);

alter table public.project_deletion_events enable row level security;
revoke all on table public.project_deletion_events from public, anon, authenticated;
grant select on table public.project_deletion_events to authenticated;
grant select, insert, update, delete on table public.project_deletion_events to service_role;

drop policy if exists "project_deletion_events_select_members" on public.project_deletion_events;
create policy "project_deletion_events_select_members"
on public.project_deletion_events for select
to authenticated
using (
  user_id = auth.uid()
);

comment on table public.project_deletion_events is
'Per-recipient terminal Realtime signals; contain only project/user UUIDs and are cascade-cleaned with the project.';

-- The low-latency wake-up topic is private. Existing authenticated members may
-- receive, but never publish, project-deleted broadcasts. Guest SSE and the
-- deletion sender use the server service role and bypass this client policy.
do $project_deletion_broadcast_policy$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists "shotcl_project_deletion_broadcast_members" on realtime.messages';
    execute $policy$
      create policy "shotcl_project_deletion_broadcast_members"
      on realtime.messages for select
      to authenticated
      using (
        exists (
          select 1
          from public.project_members as member
          join public.projects as project on project.id = member.project_id
          where member.user_id = auth.uid()
            and realtime.topic() = 'progress-project:' || member.project_id::text
            and project.deletion_started_at is null
        )
      )
    $policy$;
  end if;
end;
$project_deletion_broadcast_policy$;

-- Only begin_project_permanent_deletion may set the lock, and only the final
-- purge transaction may delete the root. This also blocks a service-route
-- request that passed access checks just before the lock was committed.
create or replace function public.guard_project_root_permanent_deletion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(
      hashtextextended('shotcl-project-permanent-deletion:' || new.id::text, 0)
    );
    if new.deletion_started_at is not null then
      raise exception 'project deletion lock is server-controlled' using errcode = '42501';
    end if;
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-permanent-deletion:' || old.id::text, 0)
  );

  if tg_op = 'DELETE' then
    if not exists (
      select 1
      from public.project_deletion_jobs as job
      where job.project_id = old.id
        and job.purge_started_at is not null
    ) then
      raise exception 'project root deletion is server-controlled' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.deletion_started_at is null then
    if new.deletion_started_at is not null
      and not exists (
        select 1
        from public.project_deletion_jobs as job
        where job.project_id = old.id
      ) then
      raise exception 'project deletion lock is server-controlled' using errcode = '42501';
    end if;
    return new;
  end if;

  -- Keep account deletion's existing FK ON DELETE SET NULL behavior intact.
  if new.created_by is null
    and old.created_by is not null
    and pg_trigger_depth() > 1
    and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;

  raise exception 'project is being permanently deleted' using errcode = '55000';
end;
$$;

drop trigger if exists projects_permanent_deletion_lock on public.projects;
create trigger projects_permanent_deletion_lock
before insert or update or delete on public.projects
for each row execute function public.guard_project_root_permanent_deletion();

-- Service-role routes can have passed their access check just before the lock.
-- This trigger closes that race for every audited project_id table as well as
-- browser/RLS writes. DELETE remains available to the purge transaction.
create or replace function public.guard_project_write_during_deletion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_entry record;
  v_entries jsonb;
  v_project_id uuid;
  v_project_ids uuid[] := '{}'::uuid[];
  v_project_id_text text;
begin
  v_entries := case
    when tg_op = 'DELETE' then jsonb_build_array(to_jsonb(old))
    else jsonb_build_array(to_jsonb(new))
  end;
  if tg_op = 'UPDATE' then
    v_entries := v_entries || jsonb_build_array(to_jsonb(old));
  end if;

  for v_entry in
    select row_data
    from jsonb_array_elements(v_entries) as entries(row_data)
  loop
    v_project_id_text := nullif(v_entry.row_data ->> 'project_id', '');
    if v_project_id_text is null then
      if tg_table_name = 'project_access_attempts' then
        continue;
      end if;
      raise exception 'project scope is required' using errcode = '23503';
    end if;
    begin
      v_project_id := v_project_id_text::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid project scope' using errcode = '23503';
    end;
    if not (v_project_id = any(v_project_ids)) then
      v_project_ids := array_append(v_project_ids, v_project_id);
    end if;
  end loop;

  select coalesce(array_agg(item order by item), '{}'::uuid[])
  into v_project_ids
  from (select distinct unnest(v_project_ids) as item) as scoped_ids;

  -- Serialize pre-lock writes with begin/purge. This is required even for the
  -- historical text project_id tables that have no FK to the project root.
  -- UPDATE checks both OLD and NEW scopes in deterministic UUID order.
  foreach v_project_id in array v_project_ids
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('shotcl-project-permanent-deletion:' || v_project_id::text, 0)
    );

    if exists (
      select 1
      from public.projects as project
      where project.id = v_project_id
        and project.deletion_started_at is null
    ) then
      continue;
    end if;

    if tg_op = 'DELETE' and exists (
      select 1
      from public.project_deletion_jobs as job
      where job.project_id = v_project_id
        and job.purge_started_at is not null
    ) then
      continue;
    end if;

    raise exception 'project is missing or being permanently deleted' using errcode = '55000';
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $attach_project_deletion_write_guards$
declare
  v_table_name text;
  v_table regclass;
begin
  foreach v_table_name in array array[
    'project_members',
    'storyboard_files',
    'daily_plans',
    'daily_plan_shots',
    'daily_plan_staff_members',
    'analysis_runs',
    'analysis_run_items',
    'shots',
    'project_basic_info',
    'project_calendar_events',
    'project_reference_assets',
    'project_costume_scenes',
    'project_costumes',
    'project_archive_folders',
    'project_staff_members',
    'project_staff_departments',
    'project_scene_items',
    'project_scene_notes',
    'shot_diagrams',
    'project_access_credentials',
    'project_access_sessions',
    'project_access_attempts',
    'project_staff_invites'
  ]
  loop
    v_table := to_regclass('public.' || v_table_name);
    if v_table is not null then
      execute format(
        'drop trigger if exists project_deletion_guard_writes on %s',
        v_table
      );
      execute format(
        'create trigger project_deletion_guard_writes before insert or update or delete on %s for each row execute function public.guard_project_write_during_deletion()',
        v_table
      );
    end if;
  end loop;
end;
$attach_project_deletion_write_guards$;

-- Storage uploads use the service role, which bypasses RLS. A database trigger
-- on the sole audited bucket prevents an already-authorized in-flight upload
-- from appearing after the final empty-prefix verification.
create or replace function public.guard_project_storage_write_during_deletion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, storage
as $$
declare
  v_entry record;
  v_entries jsonb;
  v_folders text[];
  v_project_ids uuid[] := '{}'::uuid[];
  v_project_id uuid;
begin
  v_entries := jsonb_build_array(to_jsonb(new));
  if tg_op = 'UPDATE' then
    v_entries := v_entries || jsonb_build_array(to_jsonb(old));
  end if;
  for v_entry in
    select entry ->> 'bucket_id' as bucket_id, entry ->> 'name' as name
    from jsonb_array_elements(v_entries) as entries(entry)
  loop
    if v_entry.bucket_id <> 'storyboards' then
      continue;
    end if;
    v_folders := storage.foldername(v_entry.name);
    if coalesce(array_length(v_folders, 1), 0) < 2
      or v_folders[1] not in ('projects', 'storyboard-files') then
      continue;
    end if;
    begin
      v_project_id := v_folders[2]::uuid;
    exception when invalid_text_representation then
      raise exception 'invalid project storage namespace' using errcode = '23503';
    end;
    if not (v_project_id = any(v_project_ids)) then
      v_project_ids := array_append(v_project_ids, v_project_id);
    end if;
  end loop;

  -- A cross-project rename locks both UUIDs in deterministic order, avoiding
  -- deadlocks while ensuring neither old nor new namespace is deletion-locked.
  select coalesce(array_agg(item order by item), '{}'::uuid[])
  into v_project_ids
  from (select distinct unnest(v_project_ids) as item) as scoped_ids;

  foreach v_project_id in array v_project_ids
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('shotcl-project-permanent-deletion:' || v_project_id::text, 0)
    );
    if not exists (
      select 1
      from public.projects as project
      where project.id = v_project_id
        and project.deletion_started_at is null
    ) then
      raise exception 'project storage is permanently locked' using errcode = '55000';
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists project_deletion_guard_writes on storage.objects;
create trigger project_deletion_guard_writes
before insert or update on storage.objects
for each row execute function public.guard_project_storage_write_during_deletion();

-- Project creation used to issue three independent service-role writes and
-- compensate with a direct root DELETE. The root guard deliberately forbids
-- that pattern, so creation is now one small transaction: any credential or
-- membership error rolls the new project back automatically.
create or replace function public.create_project_with_access(
  p_project_id uuid,
  p_creator_user_id uuid,
  p_project_name text,
  p_normalized_name text,
  p_shoot_date date,
  p_admin_password_hash text,
  p_admin_password_salt text,
  p_progress_password_hash text,
  p_progress_password_salt text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_project public.projects%rowtype;
begin
  if p_project_id is null
    or p_creator_user_id is null
    or btrim(coalesce(p_project_name, '')) = ''
    or btrim(coalesce(p_normalized_name, '')) = ''
    or btrim(coalesce(p_admin_password_hash, '')) = ''
    or btrim(coalesce(p_admin_password_salt, '')) = ''
    or btrim(coalesce(p_progress_password_hash, '')) = ''
    or btrim(coalesce(p_progress_password_salt, '')) = '' then
    raise exception 'invalid project creation input' using errcode = '22023';
  end if;

  insert into public.projects (
    id,
    name,
    normalized_name,
    shoot_date,
    description,
    share_enabled,
    created_by
  ) values (
    p_project_id,
    p_project_name,
    p_normalized_name,
    p_shoot_date,
    '',
    true,
    p_creator_user_id
  )
  returning * into v_project;

  insert into public.project_access_credentials (
    project_id,
    admin_password_hash,
    admin_password_salt,
    progress_password_hash,
    progress_password_salt
  ) values (
    p_project_id,
    p_admin_password_hash,
    p_admin_password_salt,
    p_progress_password_hash,
    p_progress_password_salt
  );

  insert into public.project_members (project_id, user_id, role)
  values (p_project_id, p_creator_user_id, 'admin')
  on conflict (project_id, user_id) do update set role = 'admin';

  return jsonb_build_object(
    'id', v_project.id,
    'name', v_project.name,
    'shoot_date', v_project.shoot_date,
    'description', v_project.description,
    'created_at', v_project.created_at,
    'share_enabled', v_project.share_enabled
  );
end;
$$;

-- Locks one stable Project UUID, verifies immutable owner/name inside the same
-- transaction, records retry state, then revokes every normal access path.
create or replace function public.begin_project_permanent_deletion(
  p_project_id uuid,
  p_owner_user_id uuid,
  p_confirmed_project_name text,
  p_confirmation_name_hash text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_project public.projects%rowtype;
  v_job public.project_deletion_jobs%rowtype;
begin
  if p_project_id is null
    or p_owner_user_id is null
    or p_confirmed_project_name is null
    or btrim(p_confirmed_project_name) = ''
    or p_confirmation_name_hash is null
    or p_confirmation_name_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid permanent deletion input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-permanent-deletion:' || p_project_id::text, 0)
  );

  select job.* into v_job
  from public.project_deletion_jobs as job
  where job.project_id = p_project_id
  for update;

  if found then
    if v_job.owner_user_id <> p_owner_user_id then
      raise exception 'project owner required' using errcode = '42501';
    end if;
    if v_job.confirmation_name_hash <> p_confirmation_name_hash then
      raise exception 'project name confirmation mismatch' using errcode = '22023';
    end if;
    insert into public.project_deletion_events (project_id, user_id, deletion_started_at)
    select p_project_id, recipient.user_id, now()
    from (
      select p_owner_user_id as user_id
      union
      select member.user_id
      from public.project_members as member
      where member.project_id = p_project_id
    ) as recipient
    on conflict (project_id, user_id) do update
      set deletion_started_at = excluded.deletion_started_at;
    return 'resumed';
  end if;

  select project.* into v_project
  from public.projects as project
  where project.id = p_project_id
  for update;
  if not found then
    return 'missing';
  end if;
  if v_project.created_by is null or v_project.created_by <> p_owner_user_id then
    raise exception 'project owner required' using errcode = '42501';
  end if;
  if btrim(v_project.name) <> p_confirmed_project_name then
    raise exception 'project name confirmation mismatch' using errcode = '22023';
  end if;

  insert into public.project_deletion_jobs (
    project_id,
    owner_user_id,
    confirmation_name_hash,
    storage_paths
  ) values (
    p_project_id,
    p_owner_user_id,
    p_confirmation_name_hash,
    '[]'::jsonb
  );

  update public.projects
  set deletion_started_at = now(),
      share_enabled = false
  where id = p_project_id;

  insert into public.project_deletion_events (project_id, user_id, deletion_started_at)
  select p_project_id, recipient.user_id, now()
  from (
    select p_owner_user_id as user_id
    union
    select member.user_id
    from public.project_members as member
    where member.project_id = p_project_id
  ) as recipient
  on conflict (project_id, user_id) do update
    set deletion_started_at = excluded.deletion_started_at;

  return 'started';
end;
$$;

-- Exact audited tables only; this is not a schema-wide/generic delete. The
-- root DELETE remains the final statement so all declared FK cascades provide
-- another integrity boundary. The job is removed in the same transaction.
create or replace function public.purge_project_permanently(
  p_project_id uuid,
  p_owner_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_project public.projects%rowtype;
  v_job public.project_deletion_jobs%rowtype;
  v_table_name text;
  v_table regclass;
  v_deleted_count integer;
begin
  if p_project_id is null or p_owner_user_id is null then
    raise exception 'invalid permanent deletion input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('shotcl-project-permanent-deletion:' || p_project_id::text, 0)
  );

  select job.* into v_job
  from public.project_deletion_jobs as job
  where job.project_id = p_project_id
  for update;
  if not found then
    return not exists (
      select 1 from public.projects as project where project.id = p_project_id
    );
  end if;
  if v_job.owner_user_id <> p_owner_user_id then
    raise exception 'project owner required' using errcode = '42501';
  end if;
  if v_job.storage_paths <> '[]'::jsonb then
    raise exception 'project storage inventory is not empty' using errcode = '55000';
  end if;
  if v_job.storage_verified_at is null then
    raise exception 'project storage was not verified after locking' using errcode = '55000';
  end if;

  select project.* into v_project
  from public.projects as project
  where project.id = p_project_id
  for update;

  if not found then
    -- A prior transaction may have deleted the root while its response was
    -- interrupted. Storage was re-verified by the server before this call.
    delete from public.project_deletion_events where project_id = p_project_id;
    delete from public.project_deletion_jobs where project_id = p_project_id;
    return true;
  end if;
  if v_project.created_by is null or v_project.created_by <> p_owner_user_id then
    raise exception 'project owner required' using errcode = '42501';
  end if;
  if v_project.deletion_started_at is null then
    raise exception 'permanent deletion was not started' using errcode = '55000';
  end if;

  update public.project_deletion_jobs
  set purge_started_at = now(),
      updated_at = now()
  where project_id = p_project_id;

  if to_regclass('public.shot_status_logs') is not null
    and to_regclass('public.shots') is not null then
    execute 'delete from public.shot_status_logs where shot_id in (select id from public.shots where project_id = $1)'
      using p_project_id;
  end if;

  foreach v_table_name in array array[
    'analysis_run_items',
    'daily_plan_staff_members',
    'daily_plan_shots',
    'shots',
    'analysis_runs',
    'project_costumes',
    'project_costume_scenes',
    'storyboard_files',
    'daily_plans',
    'project_basic_info',
    'project_calendar_events',
    'project_reference_assets',
    'project_archive_folders',
    'project_staff_members',
    'project_staff_departments',
    'project_access_credentials',
    'project_access_sessions',
    'project_access_attempts',
    'project_staff_invites',
    'project_members'
  ]
  loop
    v_table := to_regclass('public.' || v_table_name);
    if v_table is not null then
      execute format('delete from %s where project_id = $1', v_table)
        using p_project_id;
    end if;
  end loop;

  -- These historical/local tables intentionally store project_id as text.
  foreach v_table_name in array array[
    'project_scene_items',
    'project_scene_notes',
    'shot_diagrams'
  ]
  loop
    v_table := to_regclass('public.' || v_table_name);
    if v_table is not null then
      execute format('delete from %s where project_id = $1', v_table)
        using p_project_id::text;
    end if;
  end loop;

  delete from public.projects
  where id = p_project_id;
  get diagnostics v_deleted_count = row_count;
  if v_deleted_count <> 1 then
    raise exception 'project root delete failed' using errcode = 'P0002';
  end if;

  delete from public.project_deletion_events
  where project_id = p_project_id;
  delete from public.project_deletion_jobs
  where project_id = p_project_id;
  return true;
end;
$$;

revoke all on function public.enforce_immutable_project_creator()
  from public, anon, authenticated;
revoke all on function public.guard_project_write_during_deletion()
  from public, anon, authenticated;
revoke all on function public.guard_project_root_permanent_deletion()
  from public, anon, authenticated;
revoke all on function public.guard_project_storage_write_during_deletion()
  from public, anon, authenticated;
revoke all on function public.create_project_with_access(uuid, uuid, text, text, date, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.begin_project_permanent_deletion(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.purge_project_permanently(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_project_permanent_deletion(uuid, uuid, text, text)
  to service_role;
grant execute on function public.purge_project_permanently(uuid, uuid)
  to service_role;
grant execute on function public.create_project_with_access(uuid, uuid, text, text, date, text, text, text, text)
  to service_role;

-- Existing Progress/Guest channels add this table to the same channel. The
-- event table avoids exposing a deletion-locked projects row through RLS.
do $project_realtime_publication$
begin
  alter publication supabase_realtime add table public.project_deletion_events;
exception
  when duplicate_object then null;
  when undefined_object then null;
end;
$project_realtime_publication$;

commit;
