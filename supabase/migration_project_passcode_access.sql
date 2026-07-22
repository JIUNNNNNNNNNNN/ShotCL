-- Apply manually after reviewing existing normalized-name duplicates.
-- Passcodes are hashed by the server before reaching these tables.

alter table public.projects add column if not exists normalized_name text;
alter table public.projects add column if not exists share_enabled boolean not null default false;

update public.projects
set normalized_name = lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
where normalized_name is null;

create unique index if not exists projects_shared_normalized_name_unique
  on public.projects (normalized_name)
  where share_enabled = true;

create index if not exists projects_normalized_name_idx
  on public.projects (normalized_name);

create table if not exists public.project_access_credentials (
  project_id uuid primary key references public.projects(id) on delete cascade,
  admin_password_hash text not null,
  admin_password_salt text not null,
  progress_password_hash text not null,
  progress_password_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_access_sessions (
  browser_token_hash text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  role text not null check (role in ('admin', 'progress')),
  joined_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (browser_token_hash, project_id)
);

create index if not exists project_access_sessions_expiry_idx
  on public.project_access_sessions (expires_at);

create table if not exists public.project_access_attempts (
  attempt_key_hash text primary key,
  attempt_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);

alter table public.project_access_credentials enable row level security;
alter table public.project_access_sessions enable row level security;
alter table public.project_access_attempts enable row level security;

-- No browser role receives direct access. Only the server service role may read these tables.
revoke all on table public.project_access_credentials from anon, authenticated;
revoke all on table public.project_access_sessions from anon, authenticated;
revoke all on table public.project_access_attempts from anon, authenticated;

comment on table public.project_access_credentials is
  'Server-only scrypt hashes and salts. Never expose through browser clients.';
comment on table public.project_access_sessions is
  'Server-only project grants keyed by a SHA-256 hash of an httpOnly browser token.';
