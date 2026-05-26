-- Allow schedule_blocks rows to be deleted (e.g., stale Sports Connect duplicates)
-- without breaking FK references. Audit rows (notifications) and links
-- (slot_requests.requested_block_id, schedule_blocks.overridden_by_block_id)
-- get their FK column set to NULL instead.

alter table notifications drop constraint notifications_block_id_fkey;
alter table notifications add constraint notifications_block_id_fkey
  foreign key (block_id) references schedule_blocks(id) on delete set null;

alter table slot_requests drop constraint slot_requests_requested_block_id_fkey;
alter table slot_requests add constraint slot_requests_requested_block_id_fkey
  foreign key (requested_block_id) references schedule_blocks(id) on delete set null;

alter table schedule_blocks drop constraint schedule_blocks_overridden_by_block_id_fkey;
alter table schedule_blocks add constraint schedule_blocks_overridden_by_block_id_fkey
  foreign key (overridden_by_block_id) references schedule_blocks(id) on delete set null;
