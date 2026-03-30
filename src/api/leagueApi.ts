import { requireSupabase } from '../lib/supabase';
import type { MatchLike, ScheduledMatch } from '../lib/schedule';
import type { MatchWithScores } from '../lib/standings';

export interface SeasonRow {
  id: string;
  slug: string;
  name: string;
  default_nets: number;
  games_per_night: number;
  primary_play_day: string;
  created_at: string;
  /** When true, anon users cannot list or read this season (join link still works). */
  hide_from_public?: boolean;
}

export interface AnnouncementRow {
  id: string;
  season_id: string;
  message: string;
  created_at: string;
}

export interface LeagueFeedbackRow {
  id: string;
  season_id: string;
  message: string;
  created_at: string;
}

export interface SeasonIntakeMondayRow {
  season_id: string;
  monday_date: string;
  display_order: number;
}

export interface PlayerRow {
  id: string;
  season_id: string;
  display_name: string;
  email: string | null;
  monday_available: boolean;
  thursday_available: boolean;
  created_at: string;
}

export interface GameNightRow {
  id: string;
  season_id: string;
  night_date: string;
  net_count: number | null;
  created_at: string;
}

export interface AttendanceRow {
  game_night_id: string;
  player_id: string;
  attending: boolean;
}

export interface MatchRow {
  id: string;
  game_night_id: string;
  round_index: number;
  court_index: number;
  team_a_p1: string;
  team_a_p2: string;
  team_a_p3: string | null;
  team_b_p1: string;
  team_b_p2: string;
  team_b_p3: string | null;
  score_a: number | null;
  score_b: number | null;
  stage: string;
  stage_round: number | null;
  pool_index: number | null;
  bracket: string | null;
}

export async function rpcCreateSeason(
  name: string,
  defaultNets: number,
  gamesPerNight: number,
  firstMonday: string | null
): Promise<{ id: string; slug: string }> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('create_season_with_mondays', {
    p_name: name,
    p_default_nets: defaultNets,
    p_games_per_night: gamesPerNight,
    p_first_monday: firstMonday,
  });
  if (error) throw error;

  let row: unknown = data;
  if (typeof row === 'string') {
    try {
      row = JSON.parse(row);
    } catch {
      throw new Error(
        'Invalid JSON from create_season_with_mondays. Re-run the latest supabase/schema.sql in the SQL editor.'
      );
    }
  }
  if (!row || typeof row !== 'object') {
    throw new Error(
      'Empty response from create_season_with_mondays. Sign in as an organizer and confirm the function exists (see supabase/schema.sql).'
    );
  }
  const r = row as { id?: string; slug?: string };
  if (!r.slug) {
    throw new Error(
      'create_season_with_mondays returned an unexpected shape. Re-apply supabase/schema.sql and hard-refresh the app.'
    );
  }
  return { id: r.id ?? '', slug: r.slug };
}

export async function fetchSeasonBySlug(slug: string): Promise<SeasonRow | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('seasons')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  return data as SeasonRow | null;
}

export async function fetchSeasons(): Promise<SeasonRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('seasons')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SeasonRow[];
}

export async function fetchAnnouncements(
  seasonId: string
): Promise<AnnouncementRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('announcements')
    .select('*')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AnnouncementRow[];
}

export async function fetchLeagueFeedback(
  seasonId: string
): Promise<LeagueFeedbackRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('league_feedback')
    .select('id, season_id, message, created_at')
    .eq('season_id', seasonId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as LeagueFeedbackRow[];
}

export async function rpcSubmitLeagueFeedback(
  seasonSlug: string,
  message: string
): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('submit_league_feedback', {
    p_season_slug: seasonSlug,
    p_message: message,
  });
  if (error) throw error;
  return data as string;
}

/** Public join page only: anon cannot read season tables directly. */
export type IntakeFormData = {
  season_name: string;
  monday_dates: string[];
};

export async function rpcGetIntakeFormData(
  seasonSlug: string
): Promise<IntakeFormData | null> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('get_intake_form_data', {
    p_season_slug: seasonSlug,
  });
  if (error) throw error;
  if (data == null) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  const r = row as { season_name?: string; monday_dates?: unknown };
  if (typeof r.season_name !== 'string') return null;
  const raw = r.monday_dates;
  const monday_dates: string[] = Array.isArray(raw)
    ? raw.map((d) =>
        typeof d === 'string' ? d.slice(0, 10) : String(d).slice(0, 10)
      )
    : [];
  return { season_name: r.season_name, monday_dates };
}

export async function fetchSeasonIntakeMondays(
  seasonId: string
): Promise<SeasonIntakeMondayRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('season_intake_mondays')
    .select('*')
    .eq('season_id', seasonId)
    .order('display_order');
  if (error) throw error;
  return (data ?? []) as SeasonIntakeMondayRow[];
}

export async function fetchPlayers(seasonId: string): Promise<PlayerRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('players')
    .select('*')
    .eq('season_id', seasonId)
    .order('display_name');
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

export async function rpcRegisterPlayer(
  seasonSlug: string,
  displayName: string,
  email: string | null,
  mondayAvailability: Array<{ date: string; available: boolean }>
): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc(
    'register_player_with_monday_availability',
    {
    p_season_slug: seasonSlug,
    p_display_name: displayName,
    p_email: email ?? null,
    p_availability: mondayAvailability,
    }
  );
  if (error) throw error;
  return data as string;
}

export async function rpcAdminAddPlayer(
  seasonSlug: string,
  displayName: string,
  monday: boolean,
  thursday: boolean
): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('admin_add_player', {
    p_season_slug: seasonSlug,
    p_display_name: displayName,
    p_monday: monday,
    p_thursday: thursday,
  });
  if (error) throw error;
  return data as string;
}

export async function rpcAdminRemovePlayer(playerId: string): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('admin_remove_player', {
    p_player_id: playerId,
  });
  if (error) throw error;
}

export async function rpcAdminAddAnnouncement(
  seasonSlug: string,
  message: string
): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('admin_add_announcement', {
    p_season_slug: seasonSlug,
    p_message: message,
  });
  if (error) throw error;
  return data as string;
}

export async function rpcAdminDeleteAnnouncement(
  announcementId: string
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('admin_delete_announcement', {
    p_announcement_id: announcementId,
  });
  if (error) throw error;
}

export async function rpcAdminSetSeasonHideFromPublic(
  seasonSlug: string,
  hide: boolean
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('admin_set_season_hide_from_public', {
    p_season_slug: seasonSlug,
    p_hide: hide,
  });
  if (error) throw error;
}

export async function rpcAdminSetIntakeMondays(
  seasonSlug: string,
  mondayDates: string[]
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('admin_set_intake_mondays', {
    p_season_slug: seasonSlug,
    p_dates: mondayDates,
  });
  if (error) throw error;
}

/** Remove one Monday from the 8-week intake list, shift later weeks +7 days, add a new final Monday. Resets per-Monday availability to off for shifted/new weeks. */
export async function rpcAdminCancelAndShiftIntakeWeek(
  seasonSlug: string,
  cancelMondayIso: string
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('admin_cancel_and_shift_intake_week', {
    p_cancel_monday: cancelMondayIso,
    p_season_slug: seasonSlug,
  });
  if (error) throw error;
}

export async function fetchGameNights(seasonId: string): Promise<GameNightRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('game_nights')
    .select('*')
    .eq('season_id', seasonId)
    .order('night_date', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GameNightRow[];
}

export async function fetchGameNightById(
  id: string
): Promise<GameNightRow | null> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('game_nights')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as GameNightRow | null;
}

export async function rpcAdminCreateGameNight(
  seasonSlug: string,
  nightDate: string,
  netCount: number | null
): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('admin_create_game_night', {
    p_season_slug: seasonSlug,
    p_date: nightDate,
    p_net_count: netCount,
  });
  if (error) throw error;
  const nightId = data as string;
  const { error: seedErr } = await sb.rpc('admin_seed_attendance', {
    p_game_night_id: nightId,
  });
  if (seedErr) throw seedErr;
  return nightId;
}

export async function fetchAttendance(
  gameNightId: string
): Promise<AttendanceRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('attendance')
    .select('*')
    .eq('game_night_id', gameNightId);
  if (error) throw error;
  return (data ?? []) as AttendanceRow[];
}

export async function rpcSetAttendance(
  gameNightId: string,
  playerId: string,
  attending: boolean
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('admin_set_attendance', {
    p_game_night_id: gameNightId,
    p_player_id: playerId,
    p_attending: attending,
  });
  if (error) throw error;
}

export async function fetchMatchesForNight(
  gameNightId: string
): Promise<MatchRow[]> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('matches')
    .select('*')
    .eq('game_night_id', gameNightId)
    .order('round_index')
    .order('court_index');
  if (error) throw error;
  return (data ?? []) as MatchRow[];
}

export async function fetchMatchesForNights(
  gameNightIds: string[]
): Promise<MatchRow[]> {
  if (gameNightIds.length === 0) return [];
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('matches')
    .select('*')
    .in('game_night_id', gameNightIds);
  if (error) throw error;
  return (data ?? []) as MatchRow[];
}

export async function fetchPriorMatchLikeForSeason(
  seasonId: string,
  excludeGameNightId?: string
): Promise<MatchLike[]> {
  const sb = requireSupabase();
  const { data: nights, error: nErr } = await sb
    .from('game_nights')
    .select('id')
    .eq('season_id', seasonId);
  if (nErr) throw nErr;
  const ids = (nights ?? [])
    .map((n: { id: string }) => n.id)
    .filter((id: string) => id !== excludeGameNightId);
  if (ids.length === 0) return [];
  const { data: matches, error } = await sb
    .from('matches')
    .select('team_a_p1, team_a_p2, team_a_p3, team_b_p1, team_b_p2, team_b_p3')
    .in('game_night_id', ids);
  if (error) throw error;
  return (matches ?? []) as MatchLike[];
}

export async function fetchAllScoredMatchesForSeason(
  seasonId: string
): Promise<MatchWithScores[]> {
  const sb = requireSupabase();
  const { data: nights, error: nErr } = await sb
    .from('game_nights')
    .select('id')
    .eq('season_id', seasonId);
  if (nErr) throw nErr;
  const ids = (nights ?? []).map((n: { id: string }) => n.id);
  if (ids.length === 0) return [];
  const { data: matches, error } = await sb
    .from('matches')
    .select(
      'team_a_p1, team_a_p2, team_a_p3, team_b_p1, team_b_p2, team_b_p3, score_a, score_b'
    )
    .in('game_night_id', ids);
  if (error) throw error;
  return (matches ?? []) as MatchWithScores[];
}

export async function rpcSaveSchedule(
  gameNightId: string,
  matches: ScheduledMatch[]
): Promise<void> {
  const sb = requireSupabase();
  const payload = matches.map((m) => ({
    round_index: m.round_index,
    court_index: m.court_index,
    team_a_p1: m.team_a_p1,
    team_a_p2: m.team_a_p2,
    team_a_p3: m.team_a_p3 ?? null,
    team_b_p1: m.team_b_p1,
    team_b_p2: m.team_b_p2,
    team_b_p3: m.team_b_p3 ?? null,
    score_a: null,
    score_b: null,
  }));
  const { error } = await sb.rpc('admin_save_schedule', {
    p_game_night_id: gameNightId,
    p_matches: payload,
  });
  if (error) throw error;
}

export async function rpcClearRegularMatchesForManual(
  gameNightId: string
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('admin_clear_regular_matches', {
    p_game_night_id: gameNightId,
  });
  if (error) throw error;
}

export async function rpcInsertRegularMatch(input: {
  gameNightId: string;
  roundIndex: number;
  courtIndex: number;
  team_a_p1: string;
  team_a_p2: string;
  team_b_p1: string;
  team_b_p2: string;
  team_a_p3?: string | null;
  team_b_p3?: string | null;
}): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc('admin_insert_regular_match', {
    p_game_night_id: input.gameNightId,
    p_round_index: input.roundIndex,
    p_court_index: input.courtIndex,
    p_team_a_p1: input.team_a_p1,
    p_team_a_p2: input.team_a_p2,
    p_team_b_p1: input.team_b_p1,
    p_team_b_p2: input.team_b_p2,
    p_team_a_p3: input.team_a_p3 ?? null,
    p_team_b_p3: input.team_b_p3 ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function rpcSaveStageMatches(
  gameNightId: string,
  stage: 'playoffs_pool' | 'playoffs_gold' | 'playoffs_silver' | 'regular',
  matches: Array<{
    round_index: number;
    court_index: number;
    team_a_p1: string;
    team_a_p2: string;
    team_a_p3: string | null;
    team_b_p1: string;
    team_b_p2: string;
    team_b_p3: string | null;
    score_a: number | null;
    score_b: number | null;
    pool_index?: number | null;
    bracket?: string | null;
  }>
): Promise<void> {
  const sb = requireSupabase();
  const payload = matches.map((m) => ({
    round_index: m.round_index,
    court_index: m.court_index,
    team_a_p1: m.team_a_p1,
    team_a_p2: m.team_a_p2,
    team_a_p3: m.team_a_p3 ?? null,
    team_b_p1: m.team_b_p1,
    team_b_p2: m.team_b_p2,
    team_b_p3: m.team_b_p3 ?? null,
    score_a: m.score_a ?? null,
    score_b: m.score_b ?? null,
    pool_index: m.pool_index ?? null,
    bracket: m.bracket ?? null,
  }));
  const { error } = await sb.rpc('admin_save_stage_matches', {
    p_game_night_id: gameNightId,
    p_stage: stage,
    p_matches: payload,
  });
  if (error) throw error;
}

export async function rpcSetMatchScore(
  matchId: string,
  scoreA: number,
  scoreB: number
): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('admin_set_match_score', {
    p_match_id: matchId,
    p_score_a: scoreA,
    p_score_b: scoreB,
  });
  if (error) throw error;
}

export async function rpcAdminUpdateMatchPlayers(input: {
  matchId: string;
  team_a_p1: string;
  team_a_p2: string;
  team_a_p3: string | null;
  team_b_p1: string;
  team_b_p2: string;
  team_b_p3: string | null;
}): Promise<void> {
  const sb = requireSupabase();
  const { error } = await sb.rpc('admin_update_match_players', {
    p_match_id: input.matchId,
    p_team_a_p1: input.team_a_p1,
    p_team_a_p2: input.team_a_p2,
    p_team_a_p3: input.team_a_p3,
    p_team_b_p1: input.team_b_p1,
    p_team_b_p2: input.team_b_p2,
    p_team_b_p3: input.team_b_p3,
  });
  if (error) throw error;
}
