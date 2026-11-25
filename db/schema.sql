-- Okami no Migiude — Neon (Postgres) record structure
-- Owner: Seiko Yamaguchi
-- Flow: ElevenLabs call (Shima Enaga) -> interview_calls -> (Dify / CarbonForge) work_items -> reports
--       -> deals + follow_up_tasks -> snow warning -> message_drafts (approve, then send)
--
-- Rules
--   1. Nothing is sent to a guest until a person approves it (human in the loop).
--   2. Every row that can hold people's data can be marked synthetic, so demo data is always labelled.
--   3. A real (non-synthetic) interview needs written consent before it is stored.
--   4. Guest data is for operations (e.g. snow notices). It is not used for promotions
--      unless the guest opted in (reservations.guest_marketing_opt_in_at).
--   5. Status columns only accept the listed values, so a typo cannot break the demo.
--   6. Only a person marked can_approve at the same inn can approve a guest message.
--
-- Data handling (for the README)
--   - Real guest and owner data never goes into the 'demo' branch. Demo data is synthetic and labelled.
--   - Transcripts are stored with personal details masked.
--   - Audio is kept only when the person agreed to recording (interview_calls.recording_consent), only for the
--     uses in the consent form (e.g. a demo backup, a testimonial), and is deleted on interview_calls.audio_delete_after.
--     People who decline recording are interviewed from written notes only.
--   - The app connects with a least-privilege role; the connection string lives in env vars, never in the repo.
--   - Rows with delete_after set are deleted after that date.

create extension if not exists pgcrypto;
create extension if not exists vector;  -- for "inns like yours most often fixed this first"

-- Booking channel list (used in inns.booking_channels and reservations.channel)
--   OTA (domestic): 'rakuten_travel' | 'jalan' | 'ikyu' | 'yahoo_travel' | 'relux'
--   OTA (global):   'booking_com' | 'agoda' | 'expedia' | 'trip_com' | 'airbnb' | 'hotels_com'
--   Direct:         'own_website' | 'phone' | 'email' | 'walk_in' | 'line'
--   Other:          'travel_agency' | 'other'
-- Kept as text, not a fixed list, so a new platform can be added without changing the table.

-- Keeps updated_at current on every update
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- 1. Inns (the business). The product works for any small business; inns are the first case.
create table inns (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  business_type    text not null default 'inn'
                   check (business_type in ('inn','ski_tourism','dairy','care','construction','logistics','restaurant','fisheries','retail','other')),
  area             text not null default '定山渓',
  rooms            int,
  staff_full_time  int,
  staff_part_time  int,
  avg_price_jpy    int,                -- typical price per guest per night
  booking_channels text[],             -- channels this inn uses (channel list above)
  successor_status text check (successor_status in ('undecided','decided','none')),
  lifecycle        text not null default 'lead'
                   check (lifecycle in ('lead','contacted','interviewed','customer','paused','lost')),
  -- marketing: how and why they came to us
  first_contact_at timestamptz,
  lead_source      text check (lead_source in ('association','referral','event','inbound','outbound','partner','other')),
  lead_source_note text,               -- e.g. event name, partner name, campaign
  first_reason     text,               -- why they talked to us, in their words (e.g. '夜の予約の転記をやめたい')
  referred_by_inn  uuid references inns(id) on delete set null,
  -- marketing: what we can see from outside
  website_url      text,
  ota_ratings      jsonb,              -- e.g. {"booking_com": {"score": 8.9, "reviews": 312}}
  inbound_ratio    numeric(4,1),       -- share of overseas guests, %
  is_synthetic     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger inns_touch before update on inns for each row execute function touch_updated_at();

-- 2. People at the inn (okami, owner, staff)
create table contacts (
  id                   uuid primary key default gen_random_uuid(),
  inn_id               uuid not null references inns(id) on delete cascade,
  name                 text not null,
  role                 text not null check (role in ('okami','owner','manager','staff','successor')),
  is_decision_maker    boolean not null default false,
  can_approve          boolean not null default false,  -- may approve guest messages (e.g. the okami)
  phone                text,
  email                text,
  preferred_language   text not null default 'ja',
  consent_at           timestamptz,    -- written consent to record the interview
  marketing_opt_in_at  timestamptz,    -- agreed to receive news and updates from us
  marketing_opt_out_at timestamptz,    -- asked to stop; never contact for marketing after this
  is_synthetic         boolean not null default false,
  delete_after         date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger contacts_touch before update on contacts for each row execute function touch_updated_at();

-- 3. Interview calls (Shima Enaga, the voice agent)
create table interview_calls (
  id                    uuid primary key default gen_random_uuid(),
  inn_id                uuid not null references inns(id) on delete cascade,
  contact_id            uuid references contacts(id) on delete set null,
  elevenlabs_conv_id    text unique,   -- from the end-of-call webhook
  started_at            timestamptz,
  duration_sec          int,
  language              text,          -- 'ja' | 'en'
  consent_confirmed     boolean not null default false,  -- written consent checked before storing
  recording_consent     boolean not null default false,  -- agreed to audio recording (else notes only)
  audio_url             text,          -- where the audio is kept, only if recording_consent
  audio_delete_after    date,          -- audio is deleted on this date
  transcript_masked     text,          -- personal details masked (OrcaRouter)
  collected             jsonb,         -- ElevenLabs data collection fields (masked)
  price_answer          text,          -- answer to "would you pay for this at this price"
  all_questions_asked   boolean,       -- ElevenLabs evaluation check
  is_synthetic          boolean not null default false,
  delete_after          date,
  created_at            timestamptz not null default now(),
  constraint real_call_needs_consent check (is_synthetic or consent_confirmed),
  constraint audio_needs_recording_consent check (audio_url is null or is_synthetic or recording_consent),
  constraint audio_has_delete_date check (audio_url is null or is_synthetic or audio_delete_after is not null)
);

-- 4. Work items (what the owner does, and where the hours go)
create table work_items (
  id              uuid primary key default gen_random_uuid(),
  call_id         uuid not null references interview_calls(id) on delete cascade,
  inn_id          uuid not null references inns(id) on delete cascade,
  name            text not null,       -- e.g. '予約の転記', '雪の日の電話連絡'
  hours_per_week  numeric(5,1),
  time_of_day     text,                -- e.g. '21:00-23:00'
  done_by         text,                -- who does it: 'okami' | 'owner' | 'staff' ...
  tool            text,                -- 'paper' | 'phone' | 'spreadsheet' | 'booking site'
  waits_on        text,                -- what this task waits for
  owner_quote     text,                -- the owner's own words
  evidence        text not null default 'confirmed' check (evidence in ('confirmed','hold')),
  fix_type        text check (fix_type in ('voice_call','workflow','records','training')),
  created_at      timestamptz not null default now()
);

-- 5. Reports (the assessment)
create table reports (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid not null references interview_calls(id) on delete cascade,
  inn_id           uuid not null references inns(id) on delete cascade,
  summary          text,
  top_fixes        jsonb,              -- ranked top 3 from Neo4j
  hours_per_year   numeric(7,1),
  weather_snapshot jsonb,              -- JMA warning shown in the report
  news             jsonb,              -- cited local news (Linkup)
  embedding        vector(1536),       -- for similar-inn search
  status           text not null default 'draft' check (status in ('draft','reviewed','shared')),
  reviewed_by      text,               -- person who checked it before sharing
  share_url        text,               -- link sent to the owner (e.g. the report page)
  sent_to          text,               -- where it was sent (email)
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  constraint shared_needs_review check (status <> 'shared' or reviewed_by is not null),
  constraint sent_report_was_shared check (sent_at is null or status = 'shared')
);

-- 6. Deals (from assessment to first automation)
-- Test prices: assessment 33,000 yen (one-time), first automation 198,000 yen (one-time),
-- records 9,800 yen (monthly), training 55,000 yen (one-time). Pilot for the first 10 inns: free.
create table deals (
  id               uuid primary key default gen_random_uuid(),
  inn_id           uuid not null references inns(id) on delete cascade,
  decision_maker   uuid references contacts(id) on delete set null,
  product          text not null check (product in ('pilot','assessment','first_automation','records','training')),
  stage            text not null default 'proposed'
                   check (stage in ('proposed','agreed','in_progress','delivered','won','lost','paused')),
  amount_jpy       int not null default 0,
  billing          text not null default 'one_time' check (billing in ('one_time','monthly','free')),
  expected_close   date,
  subsidy_status   text check (subsidy_status in ('not_checked','checking_with_chamber','eligible','not_eligible')),
                   -- we never promise a subsidy; the local chamber of commerce confirms eligibility
  next_step        text,
  owner            text,               -- team member in charge
  lost_reason      text check (lost_reason in ('price','no_time','not_needed','has_tool','successor','other')),
  lost_note        text,               -- the owner's own words, if any
  stage_changed_at timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lost_needs_reason check (stage <> 'lost' or lost_reason is not null)
);
create trigger deals_touch before update on deals for each row execute function touch_updated_at();

-- 7. Follow-up tasks (filled in from the report)
create table follow_up_tasks (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid references deals(id) on delete cascade,
  inn_id       uuid not null references inns(id) on delete cascade,
  contact_id   uuid references contacts(id) on delete set null,
  title        text not null,
  due_at       timestamptz,
  assignee     text,
  status       text not null default 'open' check (status in ('open','done','cancelled')),
  source       text check (source in ('report','call','manual')),
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

-- 8. Guest reservations (used by the snow automation)
create table reservations (
  id                        uuid primary key default gen_random_uuid(),
  inn_id                    uuid not null references inns(id) on delete cascade,
  guest_name                text not null,
  channel                   text not null,   -- where the booking came from (channel list above)
  channel_ref               text,            -- booking number on that platform
  arrival_date              date not null,
  nights                    int,
  guests                    int,
  guest_country             text,            -- ISO code, e.g. 'JP', 'TW', 'KR', 'AU'
  language                  text not null default 'ja',  -- 'ja' | 'en' | 'zh-Hant' | 'ko'
  contact                   text,            -- email or phone
  arrives_by                text,            -- 'train' | 'car' | 'bus' | 'tour_bus'
  trip_purpose              text[],          -- 'onsen' | 'sightseeing' | 'ski' | 'food' | 'nature' | 'event'
                                             --   | 'anniversary' | 'family' | 'business' | 'workation' | 'other'
  is_repeat                 boolean,         -- stayed before
  guest_marketing_opt_in_at timestamptz,     -- only then may the inn send promotions
  is_synthetic              boolean not null default false,
  delete_after              date,            -- e.g. some months after the stay
  created_at                timestamptz not null default now()
);

-- 9. Message drafts (approve, then send)
create table message_drafts (
  id              uuid primary key default gen_random_uuid(),
  inn_id          uuid not null references inns(id) on delete cascade,
  reservation_id  uuid references reservations(id) on delete cascade,
  purpose         text not null default 'operations' check (purpose in ('operations','promotion')),
  trigger         text not null,       -- e.g. 'jma_heavy_snow_warning'
  trigger_ref     text,                -- warning id / train status
  language        text not null,
  send_via        text,                -- 'email' | 'sms' | 'line' | platform message ('booking_com', 'airbnb', ...)
  body            text not null,
  status          text not null default 'draft'
                  check (status in ('draft','edited','approved','rejected','sent','failed')),
  approved_by_contact_id uuid references contacts(id) on delete restrict,  -- must be a person with can_approve at this inn
  approved_at     timestamptz,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  constraint approval_has_who_and_when check (status not in ('approved','sent') or (approved_by_contact_id is not null and approved_at is not null)),
  constraint sent_needs_approval check (sent_at is null or approved_at is not null),
  constraint sent_has_time check (status <> 'sent' or sent_at is not null)
);

-- Only a person at the same inn with can_approve may approve a message
create or replace function check_message_approver() returns trigger language plpgsql as $$
begin
  if new.approved_by_contact_id is not null then
    if not exists (select 1 from contacts c
                   where c.id = new.approved_by_contact_id
                     and c.inn_id = new.inn_id
                     and c.can_approve) then
      raise exception 'approver % cannot approve messages for this inn', new.approved_by_contact_id;
    end if;
  end if;
  return new;
end $$;
create trigger message_drafts_check_approver before insert or update on message_drafts
  for each row execute function check_message_approver();

-- 10. Open data cache (JMA warnings, tourism statistics)
create table open_data_cache (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,           -- 'jma' | 'jta_guest_nights' | 'mhlw_inns'
  key         text not null,           -- e.g. area code
  payload     jsonb not null,
  attribution text not null,           -- shown on screen and in the README
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz,
  unique (source, key)
);

-- 11. Associations (how inns are connected)
create table associations (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,         -- e.g. '定山渓観光協会', '北海道旅館ホテル生活衛生同業組合'
  area   text,
  note   text
);

create table inn_associations (
  inn_id          uuid not null references inns(id) on delete cascade,
  association_id  uuid not null references associations(id) on delete cascade,
  primary key (inn_id, association_id)
);

-- 12. Testimonials (what we may say about an inn, and with what permission)
create table testimonials (
  id                uuid primary key default gen_random_uuid(),
  inn_id            uuid not null references inns(id) on delete cascade,
  contact_id        uuid references contacts(id) on delete set null,
  quote             text not null,     -- the owner's own words, as said
  result            text,              -- e.g. '週23時間 → 週8時間'
  may_use_name      boolean not null default false,
  may_use_inn_name  boolean not null default false,
  may_use_photo     boolean not null default false,
  may_use_quote     boolean not null default false,
  approved_at       timestamptz,       -- the owner checked the final wording
  created_at        timestamptz not null default now(),
  constraint use_needs_approval check (
    approved_at is not null or not (may_use_name or may_use_inn_name or may_use_photo or may_use_quote))
);

-- 13. Referrals (one okami tells the next)
create table referrals (
  id             uuid primary key default gen_random_uuid(),
  from_inn_id    uuid not null references inns(id) on delete cascade,
  to_inn_id      uuid references inns(id) on delete set null,  -- filled in once the new inn is added
  to_name        text,                           -- name before they are added
  status         text not null default 'introduced' check (status in ('introduced','met','won','lost')),
  is_pilot_terms boolean not null default false, -- part of the free-pilot deal
  created_at     timestamptz not null default now(),
  constraint referral_has_target check (to_inn_id is not null or to_name is not null)
);

-- 14. Activity log (what happened, for the demo screen)
create table activity_log (
  id        bigserial primary key,
  inn_id    uuid references inns(id) on delete cascade,
  actor     text not null,             -- 'shima_enaga' | 'dify' | 'okami' | team member
  action    text not null,             -- e.g. 'call_ended', 'report_created', 'draft_approved'
  detail    jsonb,                     -- no personal details here
  at        timestamptz not null default now()
);

-- 15. Usage checks (is the inn still using it after setup)
create table usage_checks (
  id           uuid primary key default gen_random_uuid(),
  inn_id       uuid not null references inns(id) on delete cascade,
  deal_id      uuid references deals(id) on delete set null,
  checked_at   date not null default current_date,
  checked_by   text not null,          -- team member, or 'owner' if they answered themselves
  still_using  boolean not null,
  what_used    text,                   -- e.g. 'snow messages', 'booking records'
  note         text,                   -- the owner's own words, if any
  is_synthetic boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Indexes on every foreign key and on the lists the screens show
create index on contacts (inn_id);
create index on interview_calls (inn_id);
create index on interview_calls (contact_id);
create index on work_items (call_id);
create index on work_items (inn_id);
create index on reports (call_id);
create index on reports (inn_id);
create index on deals (inn_id, stage);
create index on follow_up_tasks (inn_id, status);
create index on follow_up_tasks (deal_id);
create index on reservations (inn_id, arrival_date);
create index on message_drafts (inn_id, status);
create index on message_drafts (reservation_id);
create index on message_drafts (approved_by_contact_id);
create index on testimonials (inn_id);
create index on referrals (from_inn_id);
create index on referrals (to_inn_id);
create index on inns (referred_by_inn);
create index on inns (business_type, lifecycle);
create index on activity_log (inn_id, at);
create index on usage_checks (inn_id, checked_at);
create index on usage_checks (deal_id);
