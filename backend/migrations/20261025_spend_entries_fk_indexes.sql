-- Covering indexes for foreign keys on public.spend_entries that the
-- performance advisor reports as unindexed.
-- Do not apply from CI or from the app. Additive only: no drops, no data changes.
-- CREATE INDEX IF NOT EXISTS, without CONCURRENTLY, so this runs inside a
-- migration transaction. The table has no rows.
--
-- Foreign keys on public.spend_entries:
--   household_id                       -> households(id)
--     already covered by spend_entries_sync_idx (household_id, server_updated_at)
--   (budget_item_id, household_id)     -> budget_items(id, household_id)
--   (owner_member_id, household_id)    -> household_members(id, household_id)
--   (paid_by_member_id, household_id)  -> household_members(id, household_id)
-- spend_entries_item_idx is partial and lists only budget_item_id, so it does
-- not cover the composite budget-item foreign key.
-- updated_by is not a foreign key. spend_entries has no created_by column.

create index if not exists spend_entries_budget_item_fk_idx
  on public.spend_entries (budget_item_id, household_id);

create index if not exists spend_entries_owner_member_fk_idx
  on public.spend_entries (owner_member_id, household_id);

create index if not exists spend_entries_paid_by_member_fk_idx
  on public.spend_entries (paid_by_member_id, household_id);
