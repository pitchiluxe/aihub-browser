-- AIHub Community — the shared room.
--
-- ── Why every table has a `doc jsonb` column ───────────────────────────────
--
-- The obvious schema is a column per field. It was tried on paper and rejected.
-- `Message` alone carries seventeen optional fields — authorSeed, verse,
-- language, anonymous, replyToId, threadRootId, mentions, mentionsEveryone,
-- attachments, reactions, hiddenAt, deletedAt, deletedBy — and every one of
-- them would need a column here, a line in the mapper, and a line in the
-- reverse mapper. A field added to the TypeScript model and forgotten in the
-- mapper does not throw. It arrives as undefined on every machine except the
-- one that sent it, which is how you get a conversation that is threaded for
-- the author and flat for everybody else.
--
-- So the whole entity travels as `doc`, and only the fields Postgres itself
-- needs — for a primary key, an index, or a row level security check — are
-- promoted to real columns. Those are the fields that cannot drift, because
-- the database would reject the row.
--
-- Searching inside `doc` is not needed: every device holds a full local
-- replica and searches that.

create extension if not exists "pgcrypto";

-- ── Members ────────────────────────────────────────────────────────────────
-- auth_uid binds a member row to an anonymous Supabase session. It is the only
-- thing that makes "is this your row?" answerable inside a policy.
create table if not exists public.aihub_members (
  id         uuid primary key,
  auth_uid   uuid not null default auth.uid(),
  -- Promoted for the unique constraint. Handle uniqueness was enforced only in
  -- the main process, which works when there is one machine and fails the
  -- instant there are five racing to register the same name.
  handle_key text not null unique,
  updated_at bigint not null,
  doc        jsonb not null
);

create table if not exists public.aihub_categories (
  id         uuid primary key,
  updated_at bigint not null,
  doc        jsonb not null
);

create table if not exists public.aihub_channels (
  slug       text primary key,
  updated_at bigint not null,
  doc        jsonb not null
);

create table if not exists public.aihub_roles (
  id         uuid primary key,
  updated_at bigint not null,
  doc        jsonb not null
);

-- memberId -> roleId[], one row per member. Matches CommunityState.memberRoles
-- exactly, so there is no set-difference logic to get wrong on either side.
create table if not exists public.aihub_member_roles (
  member_id  uuid primary key references public.aihub_members(id) on delete cascade,
  role_ids   jsonb not null default '[]'::jsonb,
  updated_at bigint not null
);

-- ── Messages ───────────────────────────────────────────────────────────────
create table if not exists public.aihub_messages (
  id         uuid primary key,
  -- channel and author_id are promoted because policies and indexes need them.
  channel    text not null,
  author_id  uuid not null references public.aihub_members(id) on delete cascade,
  created_at bigint not null,
  updated_at bigint not null,
  doc        jsonb not null
);

-- The one query the chat makes constantly: the tail of a channel.
create index if not exists aihub_messages_channel_created_idx
  on public.aihub_messages (channel, created_at desc);
-- Backfill on launch pulls everything newer than what this device already has.
create index if not exists aihub_messages_updated_idx
  on public.aihub_messages (updated_at desc);

create table if not exists public.aihub_reports (
  id          uuid primary key,
  message_id  uuid not null,
  reporter_id uuid not null references public.aihub_members(id) on delete cascade,
  created_at  bigint not null,
  updated_at  bigint not null,
  doc         jsonb not null
);

create table if not exists public.aihub_audit_log (
  id         uuid primary key,
  created_at bigint not null,
  doc        jsonb not null
);

-- Exactly one owner, enforced by the primary key rather than by convention.
-- `check (id)` makes true the only legal value, so a second insert collides.
create table if not exists public.aihub_ownership (
  id         boolean primary key default true check (id),
  updated_at bigint not null,
  doc        jsonb not null
);

-- ── Row level security ─────────────────────────────────────────────────────
--
-- The anon key is a public client credential — it ships inside the app and any
-- user can read it out of their own config. RLS is therefore not a nicety here;
-- it is the entire access control system. Disabling any policy below makes the
-- room writable by anyone who has ever installed AIHub.
alter table public.aihub_members      enable row level security;
alter table public.aihub_categories   enable row level security;
alter table public.aihub_channels     enable row level security;
alter table public.aihub_roles        enable row level security;
alter table public.aihub_member_roles enable row level security;
alter table public.aihub_messages     enable row level security;
alter table public.aihub_reports      enable row level security;
alter table public.aihub_audit_log    enable row level security;
alter table public.aihub_ownership    enable row level security;

-- The current session's member id. A function rather than the same subquery
-- pasted into eleven policies.
create or replace function public.aihub_current_member_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.aihub_members where auth_uid = auth.uid() limit 1;
$$;

create or replace function public.aihub_is_moderator() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.aihub_members m
    left join public.aihub_member_roles mr on mr.member_id = m.id
    left join public.aihub_roles r
      on r.id::text in (select jsonb_array_elements_text(mr.role_ids))
    where m.auth_uid = auth.uid()
      and (
        coalesce((m.doc ->> 'isAdmin')::boolean, false)
        or r.doc -> 'permissions' ? 'manage_messages'
        or r.doc -> 'permissions' ? 'manage_members'
      )
  );
$$;

-- Everyone signed in can read the room. This is a community, not a mailbox.
-- (Direct messages are filtered by the main process against the channel's
-- participant list before they are handed to the renderer.)
drop policy if exists "read members"      on public.aihub_members;
drop policy if exists "read categories"   on public.aihub_categories;
drop policy if exists "read channels"     on public.aihub_channels;
drop policy if exists "read roles"        on public.aihub_roles;
drop policy if exists "read member_roles" on public.aihub_member_roles;
drop policy if exists "read messages"     on public.aihub_messages;
drop policy if exists "read ownership"    on public.aihub_ownership;

create policy "read members"      on public.aihub_members      for select to authenticated using (true);
create policy "read categories"   on public.aihub_categories   for select to authenticated using (true);
create policy "read channels"     on public.aihub_channels     for select to authenticated using (true);
create policy "read roles"        on public.aihub_roles        for select to authenticated using (true);
create policy "read member_roles" on public.aihub_member_roles for select to authenticated using (true);
create policy "read messages"     on public.aihub_messages     for select to authenticated using (true);
create policy "read ownership"    on public.aihub_ownership    for select to authenticated using (true);

-- A device claims exactly one member row, its own.
drop policy if exists "claim own member" on public.aihub_members;
drop policy if exists "edit own member"  on public.aihub_members;
drop policy if exists "moderate members" on public.aihub_members;

create policy "claim own member" on public.aihub_members
  for insert to authenticated with check (auth_uid = auth.uid());
create policy "edit own member" on public.aihub_members
  for update to authenticated using (auth_uid = auth.uid()) with check (auth_uid = auth.uid());
-- A ban is somebody else writing your row, so moderators need their own door.
create policy "moderate members" on public.aihub_members
  for update to authenticated using (public.aihub_is_moderator());

-- The policy that makes author_id mean something. Without it the anon key is a
-- licence to speak in anyone's name, and every handle in the room is a costume.
drop policy if exists "post as self"       on public.aihub_messages;
drop policy if exists "edit own message"   on public.aihub_messages;
drop policy if exists "moderate messages"  on public.aihub_messages;
drop policy if exists "react to messages"  on public.aihub_messages;
drop policy if exists "delete own message" on public.aihub_messages;

create policy "post as self" on public.aihub_messages
  for insert to authenticated with check (author_id = public.aihub_current_member_id());
create policy "edit own message" on public.aihub_messages
  for update to authenticated using (author_id = public.aihub_current_member_id());
create policy "moderate messages" on public.aihub_messages
  for update to authenticated using (public.aihub_is_moderator());
-- Adding a reaction is an update to someone else's row. Any member may do it;
-- which reactions are legal, and the rate at which they may be applied, stays
-- in store.ts because neither rule can be expressed here.
create policy "react to messages" on public.aihub_messages
  for update to authenticated using (true) with check (true);
create policy "delete own message" on public.aihub_messages
  for delete to authenticated
  using (author_id = public.aihub_current_member_id() or public.aihub_is_moderator());

drop policy if exists "report anything"           on public.aihub_reports;
drop policy if exists "moderators read reports"   on public.aihub_reports;
drop policy if exists "moderators resolve reports" on public.aihub_reports;

-- A reporter may file, but may not read the queue back. That asymmetry has a
-- sharp edge for clients: PostgREST's `Prefer: return=representation` turns an
-- insert into INSERT ... RETURNING, and the RETURNING is a SELECT the reporter
-- is not allowed to make — so a perfectly legal report fails with a misleading
-- "new row violates row-level security policy". Write reports with
-- return=minimal. supabase-js does this by default unless .select() is chained.
create policy "report anything" on public.aihub_reports
  for insert to authenticated with check (reporter_id = public.aihub_current_member_id());
create policy "moderators read reports"    on public.aihub_reports for select to authenticated using (public.aihub_is_moderator());
create policy "moderators resolve reports" on public.aihub_reports for update to authenticated using (public.aihub_is_moderator());

drop policy if exists "append audit"     on public.aihub_audit_log;
drop policy if exists "moderators audit" on public.aihub_audit_log;

-- Append-only by construction: insert is allowed, update and delete have no
-- policy at all, so an action cannot be un-logged after the fact.
create policy "append audit"     on public.aihub_audit_log for insert to authenticated with check (true);
create policy "moderators audit" on public.aihub_audit_log for select to authenticated using (public.aihub_is_moderator());

drop policy if exists "manage channels"     on public.aihub_channels;
drop policy if exists "manage categories"   on public.aihub_categories;
drop policy if exists "manage roles"        on public.aihub_roles;
drop policy if exists "manage member_roles" on public.aihub_member_roles;
drop policy if exists "open a dm"           on public.aihub_channels;

create policy "manage channels" on public.aihub_channels
  for all to authenticated using (public.aihub_is_moderator()) with check (public.aihub_is_moderator());
create policy "manage categories" on public.aihub_categories
  for all to authenticated using (public.aihub_is_moderator()) with check (public.aihub_is_moderator());
create policy "manage roles" on public.aihub_roles
  for all to authenticated using (public.aihub_is_moderator()) with check (public.aihub_is_moderator());
create policy "manage member_roles" on public.aihub_member_roles
  for all to authenticated using (public.aihub_is_moderator()) with check (public.aihub_is_moderator());
-- Opening a direct message creates a channel, and an ordinary member must be
-- able to do that. Narrowed to dm rows so it is not a way around the above.
create policy "open a dm" on public.aihub_channels
  for insert to authenticated with check (doc ->> 'type' = 'dm');

drop policy if exists "claim ownership" on public.aihub_ownership;
-- Guarded in the main process against a Google-verified address before it ever
-- reaches here; the primary key guarantees there is never a second owner.
create policy "claim ownership" on public.aihub_ownership
  for insert to authenticated with check (true);

-- ── Realtime ───────────────────────────────────────────────────────────────
-- Without this the client subscribes successfully and then receives nothing,
-- which is the single most confusing failure mode Supabase has: no error, no
-- warning, just a room where messages never arrive.
do $$
declare t text;
begin
  foreach t in array array[
    'aihub_messages', 'aihub_members', 'aihub_channels', 'aihub_categories',
    'aihub_roles', 'aihub_member_roles', 'aihub_reports'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Realtime sends only the primary key on DELETE unless the table replicates
-- full rows. A delete that arrives without its channel cannot be routed to the
-- right room, so every replicated table publishes whole rows.
alter table public.aihub_messages     replica identity full;
alter table public.aihub_members      replica identity full;
alter table public.aihub_channels     replica identity full;
alter table public.aihub_categories   replica identity full;
alter table public.aihub_roles        replica identity full;
alter table public.aihub_member_roles replica identity full;
alter table public.aihub_reports      replica identity full;

-- ── Table privileges ───────────────────────────────────────────────────────
--
-- Row level security decides WHICH ROWS a role may touch. It does not grant
-- the right to touch the table at all — that is a separate GRANT, and without
-- it Postgres refuses before a single policy is consulted.
--
-- This was missed the first time and the whole feature was dead against a real
-- project: every read and every write came back
--   42501  permission denied for table aihub_members
-- while the policies above sat there looking correct. Verified against a local
-- Supabase stack, not assumed — `authenticated` starts with only REFERENCES,
-- TRIGGER and TRUNCATE, and none of those move data.
--
-- The grants are deliberately per-table and per-verb rather than a blanket
-- GRANT ALL, because the absence of a privilege is itself a control:
-- aihub_audit_log gets SELECT and INSERT and nothing else, so the append-only
-- promise made above survives even if somebody later adds a careless policy.
grant select, insert, update          on public.aihub_members      to authenticated;
grant select, insert, update, delete  on public.aihub_messages     to authenticated;
grant select, insert, update, delete  on public.aihub_channels     to authenticated;
grant select, insert, update, delete  on public.aihub_categories   to authenticated;
grant select, insert, update, delete  on public.aihub_roles        to authenticated;
grant select, insert, update, delete  on public.aihub_member_roles to authenticated;
grant select, insert, update          on public.aihub_reports      to authenticated;
grant select, insert                  on public.aihub_audit_log    to authenticated;
grant select, insert                  on public.aihub_ownership    to authenticated;

-- ── The reaction hole ──────────────────────────────────────────────────────
--
-- "react to messages" was `for update using (true) with check (true)`, because
-- adding a reaction means writing a row you do not own. Permissive policies on
-- the same command are OR'd together, so that one policy silently granted
-- every authenticated member unrestricted UPDATE on every message — making
-- "edit own message" and "moderate messages" decorative.
--
-- Demonstrated against a live database, not theorised: a second ordinary
-- member rewrote another member's text, and cleared `hiddenAt` on a message a
-- moderator had hidden. The comment claimed the real limits lived in store.ts,
-- but store.ts runs on the attacker's own machine.
--
-- It cannot be repaired with a policy. WITH CHECK sees only the incoming row,
-- so no policy can express "everything except reactions must be unchanged" —
-- that comparison needs OLD, which only a trigger gets.
create or replace function public.aihub_guard_message_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Moderators and the author keep full control of the row.
  if public.aihub_is_moderator() then return new; end if;
  if old.author_id = public.aihub_current_member_id() then return new; end if;

  -- Everyone else may touch reactions and nothing else. Comparing the doc with
  -- the reactions key removed is the whole rule.
  if (new.doc - 'reactions') is distinct from (old.doc - 'reactions')
     or new.id         is distinct from old.id
     or new.channel    is distinct from old.channel
     or new.author_id  is distinct from old.author_id
     or new.created_at is distinct from old.created_at then
    raise exception 'only reactions may be changed on another member''s message'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists aihub_guard_message_update on public.aihub_messages;
create trigger aihub_guard_message_update
  before update on public.aihub_messages
  for each row execute function public.aihub_guard_message_update();
