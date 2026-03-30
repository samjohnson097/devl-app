-- Optional: if you hit RLS issues inside SECURITY DEFINER functions, run these.
-- Signatures must match your current schema.sql.

alter function public.assert_authenticated() set row_security = off;
alter function public.create_season(text, integer, integer) set row_security = off;
alter function public.register_player(text, text, text, boolean, boolean) set row_security = off;
alter function public.assert_season_admin(uuid, uuid) set row_security = off;
alter function public.admin_create_game_night(text, date, integer) set row_security = off;
alter function public.admin_seed_attendance(uuid) set row_security = off;
alter function public.admin_set_attendance(uuid, uuid, boolean) set row_security = off;
alter function public.admin_add_player(text, text, boolean, boolean) set row_security = off;
alter function public.admin_remove_player(uuid) set row_security = off;
alter function public.admin_save_schedule(uuid, jsonb) set row_security = off;
alter function public.admin_set_match_score(uuid, integer, integer) set row_security = off;
alter function public.create_season_with_mondays(text, integer, integer, date) set row_security = off;
alter function public.admin_set_intake_mondays(text, jsonb) set row_security = off;
alter function public.register_player_with_monday_availability(text, text, text, jsonb) set row_security = off;
alter function public.admin_add_announcement(text, text) set row_security = off;
alter function public.admin_delete_announcement(uuid) set row_security = off;
alter function public.admin_clear_regular_matches(uuid) set row_security = off;
alter function public.admin_insert_regular_match(uuid, integer, integer, uuid, uuid, uuid, uuid, uuid, uuid) set row_security = off;
