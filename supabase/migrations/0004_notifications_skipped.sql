alter table notifications drop constraint notifications_status_check;
alter table notifications add constraint notifications_status_check
  check (status in ('pending','sent','failed','delivered','skipped'));
