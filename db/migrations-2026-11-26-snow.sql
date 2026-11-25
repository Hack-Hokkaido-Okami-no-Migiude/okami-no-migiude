-- Apply once to a Neon branch created from the earlier db/schema.sql, so the
-- app can upsert its guests and snow-day messages (server/neon/sync.ts).
alter table reservations   add column if not exists app_ref text unique;
alter table message_drafts add column if not exists app_ref text unique;
