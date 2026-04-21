-- Session 4 redesign: slot_requests stores a time-range request directly,
-- not a reference to a pre-existing open_slot block. Add field_id/start_at/end_at
-- and make requested_block_id nullable (only set when admin approves and creates
-- the confirmed block).

alter table slot_requests
  add column if not exists field_id uuid references fields(id);

alter table slot_requests
  add column if not exists start_at timestamptz;

alter table slot_requests
  add column if not exists end_at timestamptz;

alter table slot_requests
  alter column requested_block_id drop not null;

-- Index for admin queue queries
create index if not exists slot_requests_field_start_idx
  on slot_requests (field_id, start_at);
