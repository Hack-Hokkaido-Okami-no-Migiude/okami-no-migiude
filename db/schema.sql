-- Okami no Migiude: Neon schema (5 tables)
--
-- What lives here: the inn, the AI interview, the report, and the inn's
-- guests (reservations) with the message drafts the okami approves.
-- Sales follow-up (deals, tasks) is out of scope for this database.
--
-- Data handling:
-- - The app never stores audio, so there is no audio column.
-- - Every interview needs a consent time. Transcripts carry a delete_after date.
-- - A message can only be sent after the okami approves it.
-- - Marketing messages go only to guests who opted in.
-- - Demo rows are marked is_synthetic = true.
--
-- No secrets or connection strings in this file.

create extension if not exists pgcrypto;

-- 1. Inns (from the app's owner profile)
create table inns (
  id             uuid primary key default gen_random_uuid(),
  app_user_id    text unique,                 -- owner_profiles.user_id in the app
  name           text not null,
  business_type  text not null,
  municipality   text,
  website_url    text,
  owner_name     text not null,               -- the okami, who approves messages
  phone          text,
  email          text,
  language       text not null default 'ja' check (language in ('ja', 'en')),
  is_synthetic   boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 2. Interviews (from the app's scripted interview or voice chat)
create table interviews (
  id              uuid primary key default gen_random_uuid(),
  app_ref         text unique,                -- interviews.id or voice conversation_id in the app
  inn_id          uuid not null references inns(id) on delete cascade,
  mode            text not null check (mode in ('script', 'voice')),
  consent_at      timestamptz not null,       -- no interview without consent
  started_at      timestamptz not null,
  submitted_at    timestamptz,
  transcript      text,
  research_cases  jsonb,                      -- similar businesses found during the call
  delete_after    date,
  is_synthetic    boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint consent_before_start check (consent_at <= started_at),
  constraint transcript_has_delete_date check (transcript is null or delete_after is not null)
);

-- 3. Reports (from the app's report)
create table reports (
  id                         uuid primary key default gen_random_uuid(),
  app_ref                    text unique,     -- reports.id in the app
  interview_id               uuid not null unique references interviews(id) on delete cascade,
  inn_id                     uuid not null references inns(id) on delete cascade,
  language                   text not null check (language in ('ja', 'en')),
  status                     text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  content                    text,
  work_items                 jsonb not null default '[]'::jsonb,  -- [{name, hours_per_week, done_by, tool, waits_on, owner_quote}]
  hours_per_year             numeric(7,1),
  ready_at                   timestamptz,
  consultation_requested_at  timestamptz,
  sent_at                    timestamptz,
  created_at                 timestamptz not null default now(),
  constraint work_items_is_list check (jsonb_typeof(work_items) = 'array'),
  constraint ready_has_content check (status <> 'ready' or (content is not null and ready_at is not null)),
  constraint only_ready_reports_are_sent check (sent_at is null or status = 'ready')
);

-- 4. Reservations and guests (sample bookings for the demo)
create table reservations (
  id                   uuid primary key default gen_random_uuid(),
  inn_id               uuid not null references inns(id) on delete cascade,
  guest_name           text not null,
  guest_country        text,
  language             text not null,       -- e.g. ja, en, zh-TW, ko
  contact              text,
  arrival_date         date not null,
  nights               int not null default 1 check (nights > 0),
  arrives_by           text,                -- e.g. JR, bus, rental car
  marketing_opt_in_at  timestamptz,         -- null = no marketing messages
  is_synthetic         boolean not null default false,
  created_at           timestamptz not null default now()
);

-- 5. Message drafts to guests, approved by the okami
create table message_drafts (
  id              uuid primary key default gen_random_uuid(),
  inn_id          uuid not null references inns(id) on delete cascade,
  reservation_id  uuid references reservations(id) on delete cascade,
  purpose         text not null check (purpose in ('check_in', 'snow_day', 'marketing', 'other')),
  language        text not null,
  body            text not null,
  status          text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'discarded')),
  approved_at     timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  constraint approved_needs_time check (status not in ('approved', 'sent') or approved_at is not null),
  constraint sent_needs_time check (status <> 'sent' or sent_at is not null),
  constraint sent_only_after_approval check (sent_at is null or (approved_at is not null and sent_at >= approved_at))
);

-- Rows that point at each other must belong to the same inn,
-- and marketing messages need the guest's opt-in.
create or replace function check_report() returns trigger language plpgsql as $$
declare
  other_inn uuid;
begin
  select inn_id into other_inn from interviews where id = new.interview_id;
  if other_inn is distinct from new.inn_id then
    raise exception 'report inn does not match its interview';
  end if;
  return new;
end $$;

create or replace function check_message_draft() returns trigger language plpgsql as $$
declare
  other_inn uuid;
  opted_in  timestamptz;
begin
  if new.reservation_id is not null then
    select inn_id, marketing_opt_in_at into other_inn, opted_in
      from reservations where id = new.reservation_id;
    if other_inn is distinct from new.inn_id then
      raise exception 'message inn does not match its reservation';
    end if;
  end if;
  if new.purpose = 'marketing' and new.status in ('approved', 'sent') and opted_in is null then
    raise exception 'guest has not opted in to marketing messages';
  end if;
  return new;
end $$;

create trigger reports_check before insert or update on reports
  for each row execute function check_report();
create trigger message_drafts_check before insert or update on message_drafts
  for each row execute function check_message_draft();

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger inns_touch before update on inns
  for each row execute function touch_updated_at();

create index on interviews (inn_id);
create index on reports (inn_id);
create index on reservations (inn_id, arrival_date);
create index on message_drafts (inn_id, status);
