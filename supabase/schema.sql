-- SciBowl Arena — Supabase schema for rounds and user data/statistics.
-- Run this once in your Supabase project: Dashboard → SQL Editor → paste → Run.
-- (Safe to re-run: every statement is `if not exists` / idempotent.)
--
-- Layout: common columns + a `data` jsonb column holding the entity fields
-- (subject_stats, game_history, score, etc.). Fields that are queried or
-- filtered on rather than merely stored are "promoted" to real columns — see
-- PROMOTED_COLUMNS in server/supabase.js, which must agree with this file.
-- The app server accesses these tables with the service-role key, which
-- bypasses RLS; RLS is enabled with no policies so the tables are unreachable
-- with the public anon key.

-- Registered users, mirrored from Clerk on sign-in. Clerk owns identity
-- (credentials, sessions); this table owns what the app needs to authorize:
-- the role. `id` is the Clerk user id.
--
-- role: 'admin' — may create and edit PUBLIC packets (and private ones)
--       'player' — may create and edit only their OWN PRIVATE packets
create table if not exists public.app_users (
  id text primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text,
  email text,
  full_name text,
  role text not null default 'player',
  data jsonb not null default '{}'::jsonb,
  constraint app_users_role_check check (role in ('player', 'admin'))
);

create unique index if not exists app_users_email_key on public.app_users (lower(email));
create index if not exists app_users_role_idx on public.app_users (role);

-- Science Bowl rounds/packets. The parsed questions array lives inside `data`
-- (data->'questions'), mirroring the Round entity schema in base44/entities.
--
-- `name`, `is_public` and `owner_email` are real columns: visibility is
-- filtered on for every library read, so it cannot sit inside jsonb.
--   is_public = true  → listed for everyone (admins only may create these)
--   is_public = false → visible only to owner_email, but still playable by
--                       everyone in a multiplayer room the owner hosts
create table if not exists public.rounds (
  id text primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text,
  name text,
  is_public boolean not null default false,
  owner_email text,
  data jsonb not null default '{}'::jsonb
);

-- Migration for tables created before these columns existed. `if not exists`
-- makes each step a no-op once applied, so the whole file stays re-runnable.
alter table public.rounds add column if not exists name text;
alter table public.rounds add column if not exists is_public boolean not null default false;
alter table public.rounds add column if not exists owner_email text;

-- Backfill from the jsonb copies these fields used to live in. Each statement
-- is scoped to rows that still carry the old shape, and the final statement
-- removes that shape — so the whole block is a no-op on the second run.
update public.rounds
  set name = data->>'title'
  where name is null and data ? 'title';

-- Visibility defaults to public here (not to the column default of false):
-- everything that predates this migration was already in the shared library,
-- and silently privatizing a whole library would be the worse failure.
update public.rounds
  set is_public = coalesce((data->>'is_public')::boolean, true)
  where data ? 'is_public';

-- Ownership only matters for private packets. Pre-migration rows were uploaded
-- through the app (uploaded_by holds an email) or bulk-imported (created_by is
-- 'import-script', not a person) — so only adopt a real address.
update public.rounds
  set owner_email = data->>'uploaded_by'
  where owner_email is null and data->>'uploaded_by' like '%@%';

-- The promoted columns are now authoritative; drop the stale jsonb copies so
-- there is exactly one source of truth per field.
update public.rounds
  set data = data - 'title' - 'is_public'
  where data ?| array['title', 'is_public'];

create index if not exists rounds_name_idx on public.rounds (name);
create index if not exists rounds_public_idx on public.rounds (is_public);
create index if not exists rounds_owner_idx on public.rounds (owner_email);
create index if not exists rounds_source_idx
  on public.rounds ((data->>'source'));
create index if not exists rounds_year_idx
  on public.rounds ((data->>'year'));
create index if not exists rounds_created_idx
  on public.rounds (created_date desc);

-- Editable site content (help/guide page), stored one row per part of the page:
-- a `header` row, one `section` row per section, and a `cta` row. Each row's
-- data holds { kind, slug, position, content } where `content` is just that
-- part; `slug` is the stable row identity ('header', the section id, 'cta') and
-- `position` orders the sections. The app reassembles them and falls back to its
-- bundled default when the table is empty. Seed/refresh with: npm run seed:help
create table if not exists public.help_content (
  id text primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text,
  data jsonb not null default '{}'::jsonb
);

create index if not exists help_content_kind_idx
  on public.help_content ((data->>'kind'));
create index if not exists help_content_position_idx
  on public.help_content (((data->'position')::numeric));
-- One row per part: the seed script matches on slug to update in place.
create unique index if not exists help_content_slug_key
  on public.help_content ((data->>'slug'))
  where data->>'slug' is not null;

-- Migration: split a pre-split row (one row holding the whole page document in
-- data->'content') into per-part rows. No-op once the table holds split rows,
-- so this is safe to re-run along with the rest of the file.
do $$
declare
  legacy record;
begin
  for legacy in
    select id, created_by, data->'content' as content
    from public.help_content
    where jsonb_typeof(data->'content'->'sections') = 'array'
  loop
    insert into public.help_content (id, created_by, data)
    select
      legacy.id || '-header', legacy.created_by,
      jsonb_build_object('kind', 'header', 'slug', 'header', 'position', 0,
                         'content', legacy.content->'header')
    where jsonb_typeof(legacy.content->'header') = 'object'
    on conflict do nothing;

    insert into public.help_content (id, created_by, data)
    select
      legacy.id || '-' || coalesce(section->>'id', 'section-' || idx),
      legacy.created_by,
      jsonb_build_object(
        'kind', 'section',
        'slug', coalesce(section->>'id', 'section-' || idx),
        'position', idx * 10,
        'content', section)
    from jsonb_array_elements(legacy.content->'sections') with ordinality as t(section, idx)
    on conflict do nothing;

    insert into public.help_content (id, created_by, data)
    select
      legacy.id || '-cta', legacy.created_by,
      jsonb_build_object('kind', 'cta', 'slug', 'cta', 'position', 10000,
                         'content', legacy.content->'cta')
    where jsonb_typeof(legacy.content->'cta') = 'object'
    on conflict do nothing;

    delete from public.help_content where id = legacy.id;
  end loop;
end $$;

create table if not exists public.user_stats (
  id text primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text,
  data jsonb not null default '{}'::jsonb
);

create index if not exists user_stats_email_idx
  on public.user_stats ((data->>'user_email'));
create index if not exists user_stats_created_idx
  on public.user_stats (created_date desc);

create table if not exists public.leaderboard_entries (
  id text primary key,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now(),
  created_by text,
  data jsonb not null default '{}'::jsonb
);

create index if not exists leaderboard_entries_username_idx
  on public.leaderboard_entries ((data->>'username'));
create index if not exists leaderboard_entries_score_idx
  on public.leaderboard_entries (((data->'score')::numeric) desc);
create index if not exists leaderboard_entries_created_idx
  on public.leaderboard_entries (created_date desc);

-- Lock the tables down for anon/authenticated clients (service role bypasses RLS).
alter table public.app_users enable row level security;
alter table public.rounds enable row level security;
alter table public.help_content enable row level security;
alter table public.user_stats enable row level security;
alter table public.leaderboard_entries enable row level security;

-- Note: uploaded packet files (PDF/DOCX) are stored in a public Storage bucket
-- named `uploads`; the app server auto-creates it on first upload — no SQL
-- needed here.
