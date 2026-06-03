-- Soft-remove players from roster without deleting past games.
-- After this patch, re-run admin_remove_player and admin_seed_attendance from schema.sql
-- (or copy those function bodies from the latest schema.sql).

alter table public.players
  add column if not exists removed_at timestamptz;
