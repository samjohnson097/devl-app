import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  fetchAnnouncements,
  fetchAllScoredMatchesForSeason,
  fetchAttendance,
  fetchGameNights,
  fetchMatchesForNight,
  fetchPlayers,
  fetchSeasonBySlug,
  fetchSeasons,
  fetchSeasonIntakeMondays,
  fetchLeagueFeedback,
  rpcAdminAddAnnouncement,
  rpcAdminAddPlayer,
  rpcAdminCreateGameNight,
  rpcAdminDeleteAnnouncement,
  rpcAdminSetSeasonHideFromPublic,
  rpcAdminRemovePlayer,
  rpcAdminUpdatePlayerName,
  rpcAdminCancelAndShiftIntakeWeek,
  rpcAdminSetIntakeMondays,
  rpcSaveStageMatches,
  rpcSetAttendance,
  type AnnouncementRow,
  type LeagueFeedbackRow,
  type GameNightRow,
  type PlayerRow,
  type SeasonIntakeMondayRow,
  type SeasonRow,
} from '../api/leagueApi';
import {
  buildPlayoffPoolMatchPayload,
  buildSingleElimRound1Matches,
  computePoolStandingsFromMatches,
  selectBracketSeedsFromPools,
} from '../lib/playoffs';
import {
  computeStandings,
  formatWinPctDisplay,
  rankPlayerIdsForPlayoffSeeding,
} from '../lib/standings';
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import { withJwtRetry } from '../auth/sessionRefresh';
import { ConfigBanner, Layout } from '../components/Layout';
import { formatAppError } from '../lib/errors';
import { formatOrdinalLongDate } from '../lib/dates';
import {
  getDefaultSeasonSlug,
  setDefaultSeasonSlug,
} from '../lib/adminPreferences';
import { useAuth } from '../auth/AuthContext';

export function AdminSeasonPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [season, setSeason] = useState<SeasonRow | null | undefined>(undefined);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [nights, setNights] = useState<GameNightRow[]>([]);
  const [standings, setStandings] = useState<ReturnType<
    typeof computeStandings
  >>([]);
  const [tab, setTab] = useState<
    'players' | 'nights' | 'playoffs' | 'standings' | 'settings'
  >('players');
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [leagueFeedback, setLeagueFeedback] = useState<LeagueFeedbackRow[]>([]);
  const [intakeMondays, setIntakeMondays] = useState<SeasonIntakeMondayRow[]>([]);
  const [announcementText, setAnnouncementText] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cancelWeekDate, setCancelWeekDate] = useState<string>('');
  const [playoffDate, setPlayoffDate] = useState<string>('');
  const [playoffPoolCount, setPlayoffPoolCount] = useState(2);
  const [playoffRrGames, setPlayoffRrGames] = useState(3);
  const [playoffGoldPerPool, setPlayoffGoldPerPool] = useState(2);
  const [playoffSilverPerPool, setPlayoffSilverPerPool] = useState(2);
  /** Player id → included in playoff pool generation */
  const [playoffRoster, setPlayoffRoster] = useState<Record<string, boolean>>({});
  const [playoffWalkOnName, setPlayoffWalkOnName] = useState('');
  const [playoffOk, setPlayoffOk] = useState<string | null>(null);
  const [playoffMatches, setPlayoffMatches] = useState<
    Array<Awaited<ReturnType<typeof fetchMatchesForNight>>[number]>
  >([]);
  const [playoffMatchesLoading, setPlayoffMatchesLoading] = useState(false);
  const [allSeasons, setAllSeasons] = useState<
    Array<{ id: string; slug: string; name: string }>
  >([]);
  const [defaultSeasonDraft, setDefaultSeasonDraft] = useState<string>('');
  const [defaultSeasonSaved, setDefaultSeasonSaved] = useState(false);
  const [hideFromPublic, setHideFromPublic] = useState(false);
  const [hideFromPublicBusy, setHideFromPublicBusy] = useState(false);
  const [editPlayerId, setEditPlayerId] = useState<string | null>(null);
  const [editPlayerDraft, setEditPlayerDraft] = useState('');
  const [editPlayerBusy, setEditPlayerBusy] = useState(false);

  const playoffDateStorageKey = useMemo(
    () => (season?.id ? `devl:playoffDate:${season.id}` : null),
    [season?.id]
  );

  function addDaysIso(iso: string, days: number): string {
    // ISO date only: interpret in local time to avoid off-by-one.
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + days);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  const reload = useCallback(async () => {
    if (!slug || !isSupabaseConfigured) return;
    setErr(null);
    const s = await fetchSeasonBySlug(slug);
    setSeason(s);
    if (!s) return;
    setHideFromPublic(!!s.hide_from_public);
    const [pl, gn, matches, anns, mondays, feedback] = await Promise.all([
      fetchPlayers(s.id),
      fetchGameNights(s.id),
      fetchAllScoredMatchesForSeason(s.id),
      fetchAnnouncements(s.id),
      fetchSeasonIntakeMondays(s.id),
      fetchLeagueFeedback(s.id),
    ]);
    setPlayers(pl);
    setNights(gn);
    setAnnouncements(anns);
    setLeagueFeedback(feedback);
    setIntakeMondays(mondays);
    setStandings(computeStandings(pl, matches));
    try {
      const sb = requireSupabase();
      const seasonsList = await withJwtRetry(sb, () => fetchSeasons());
      setAllSeasons(
        seasonsList.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
        }))
      );
    } catch {
      setAllSeasons((prev) =>
        prev.length > 0
          ? prev
          : [{ id: s.id, slug: s.slug, name: s.name }]
      );
    }
  }, [slug]);

  useEffect(() => {
    reload().catch((e) => setErr(e instanceof Error ? e.message : 'Load failed'));
  }, [reload]);

  const hydratePlayoffRosterForDate = useCallback(
    async (date: string) => {
      if (!date || players.length === 0) return;
      setErr(null);
      try {
        const night = nights.find((n) => n.night_date === date);
        if (night) {
          const rows = await fetchAttendance(night.id);
          const byPid = new Map(rows.map((r) => [r.player_id, r.attending]));
          setPlayoffRoster(
            Object.fromEntries(
              players.map((p) => [p.id, byPid.get(p.id) ?? true])
            )
          );
        } else {
          setPlayoffRoster(
            Object.fromEntries(players.map((p) => [p.id, true]))
          );
        }
      } catch (er: unknown) {
        setErr(formatAppError(er));
      }
    },
    [nights, players]
  );

  const playoffNightId = useMemo(() => {
    if (!playoffDate) return null;
    return nights.find((n) => n.night_date === playoffDate)?.id ?? null;
  }, [nights, playoffDate]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.display_name);
    return m;
  }, [players]);

  const playoffPoolMatches = useMemo(
    () => playoffMatches.filter((m) => m.stage === 'playoffs_pool'),
    [playoffMatches]
  );
  const playoffGoldMatches = useMemo(
    () => playoffMatches.filter((m) => m.stage === 'playoffs_gold'),
    [playoffMatches]
  );
  const playoffSilverMatches = useMemo(
    () => playoffMatches.filter((m) => m.stage === 'playoffs_silver'),
    [playoffMatches]
  );
  const playoffsGenerated = playoffPoolMatches.length > 0;
  const playoffStandingsByPool = useMemo(
    () => computePoolStandingsFromMatches(playoffPoolMatches),
    [playoffPoolMatches]
  );
  const playoffPoolIndices = useMemo(
    () => Array.from(playoffStandingsByPool.keys()).sort((a, b) => a - b),
    [playoffStandingsByPool]
  );

  const loadPlayoffMatchesForSelectedDate = useCallback(async () => {
    if (!playoffNightId) {
      setPlayoffMatches([]);
      return;
    }
    setPlayoffMatchesLoading(true);
    setErr(null);
    try {
      const ms = await fetchMatchesForNight(playoffNightId);
      setPlayoffMatches(ms);
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setPlayoffMatchesLoading(false);
    }
  }, [playoffNightId]);

  async function resetPlayoffs() {
    if (!slug || !playoffDate) {
      setErr('Choose a playoff date first.');
      return;
    }
    const nightId = playoffNightId;
    if (!nightId) {
      setErr('No game night exists for this playoff date yet.');
      return;
    }
    const ok = window.confirm(
      'Reset playoffs for this date?\n\n' +
        '• Deletes pool matches\n' +
        '• Deletes gold bracket matches\n' +
        '• Deletes silver bracket matches\n\n' +
        'Scores for those matches will be lost.'
    );
    if (!ok) return;

    setBusy(true);
    setErr(null);
    setPlayoffOk(null);
    try {
      await Promise.all([
        rpcSaveStageMatches(nightId, 'playoffs_pool', []),
        rpcSaveStageMatches(nightId, 'playoffs_gold', []),
        rpcSaveStageMatches(nightId, 'playoffs_silver', []),
      ]);
      await loadPlayoffMatchesForSelectedDate();
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function openPlayoffNight() {
    if (!slug) return;
    if (!playoffDate) {
      setErr('Playoff date is not set.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const nightId =
        nights.find((n) => n.night_date === playoffDate)?.id ??
        (await rpcAdminCreateGameNight(slug, playoffDate, null));
      navigate(`/league/${slug}/admin/night/${nightId}`);
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  const seasonsForDefaultPicker = useMemo(() => {
    const list = allSeasons.slice();
    if (season && !list.some((x) => x.id === season.id)) {
      list.unshift({ id: season.id, slug: season.slug, name: season.name });
    }
    return list;
  }, [allSeasons, season]);

  useEffect(() => {
    if (tab !== 'settings' || !session?.user?.id) return;
    const saved = getDefaultSeasonSlug(session.user.id);
    setDefaultSeasonDraft(saved ?? slug ?? '');
    setDefaultSeasonSaved(false);
  }, [tab, session?.user?.id, slug]);

  useEffect(() => {
    if (tab !== 'settings' || seasonsForDefaultPicker.length === 0) return;
    setDefaultSeasonDraft((prev) =>
      seasonsForDefaultPicker.some((s) => s.slug === prev)
        ? prev
        : slug ?? seasonsForDefaultPicker[0].slug
    );
  }, [seasonsForDefaultPicker, tab, slug]);

  function saveDefaultSeasonPreference() {
    if (!session?.user?.id) return;
    setDefaultSeasonSlug(session.user.id, defaultSeasonDraft.trim() || null);
    setDefaultSeasonSaved(true);
  }

  async function saveSeasonVisibility() {
    if (!slug) return;
    setHideFromPublicBusy(true);
    setErr(null);
    try {
      const sb = requireSupabase();
      await withJwtRetry(sb, () =>
        rpcAdminSetSeasonHideFromPublic(slug, hideFromPublic)
      );
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setHideFromPublicBusy(false);
    }
  }

  useEffect(() => {
    if (tab !== 'playoffs') return;
    setPlayoffRoster((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const p of players) {
        if (!(p.id in next)) {
          next[p.id] = true;
          changed = true;
        }
      }
      for (const id of Object.keys(next)) {
        if (!players.some((p) => p.id === id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tab, players]);

  // Initialize and persist playoff date per season so admins can always get back
  // to the same playoff night without re-entering it.
  useEffect(() => {
    if (!playoffDateStorageKey) return;
    if (playoffDate) return;
    try {
      const saved = window.localStorage.getItem(playoffDateStorageKey);
      if (saved) {
        setPlayoffDate(saved);
        return;
      }
    } catch {
      // ignore storage failures
    }
    if (intakeMondays.length > 0) {
      const last = intakeMondays[intakeMondays.length - 1]?.monday_date;
      if (last) setPlayoffDate(addDaysIso(last, 7));
    }
  }, [playoffDateStorageKey, playoffDate, intakeMondays]);

  useEffect(() => {
    if (!playoffDateStorageKey || !playoffDate) return;
    try {
      window.localStorage.setItem(playoffDateStorageKey, playoffDate);
    } catch {
      // ignore storage failures
    }
  }, [playoffDateStorageKey, playoffDate]);

  useEffect(() => {
    if (tab !== 'playoffs') return;
    void loadPlayoffMatchesForSelectedDate();
  }, [tab, loadPlayoffMatchesForSelectedDate]);

  async function addPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || !newName.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await rpcAdminAddPlayer(slug, newName.trim(), true, false);
      setNewName('');
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function removePlayer(id: string) {
    if (!window.confirm('Remove this player from the season?')) return;
    setBusy(true);
    setErr(null);
    try {
      await rpcAdminRemovePlayer(id);
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  function openEditPlayer(p: PlayerRow) {
    setErr(null);
    setEditPlayerId(p.id);
    setEditPlayerDraft(p.display_name);
  }

  async function saveEditPlayer() {
    if (!editPlayerId) return;
    const next = editPlayerDraft.trim();
    if (!next) {
      setErr('Name required.');
      return;
    }
    setEditPlayerBusy(true);
    setErr(null);
    try {
      const sb = requireSupabase();
      await withJwtRetry(sb, () => rpcAdminUpdatePlayerName(editPlayerId, next));
      setEditPlayerId(null);
      setEditPlayerDraft('');
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setEditPlayerBusy(false);
    }
  }

  async function addNight(nightDate: string) {
    if (!slug || !nightDate) return;
    setBusy(true);
    setErr(null);
    try {
      await rpcAdminCreateGameNight(slug, nightDate, null);
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function addAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || !announcementText.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await rpcAdminAddAnnouncement(slug, announcementText.trim());
      setAnnouncementText('');
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function removeAnnouncement(id: string) {
    setBusy(true);
    setErr(null);
    try {
      await rpcAdminDeleteAnnouncement(id);
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function saveMondays() {
    if (!slug) return;
    setBusy(true);
    setErr(null);
    try {
      const dates = intakeMondays
        .map((m) => m.monday_date)
        .filter(Boolean);
      await rpcAdminSetIntakeMondays(slug, dates);
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function cancelAndShiftWeek() {
    if (!slug || !cancelWeekDate) return;
    const label = formatOrdinalLongDate(cancelWeekDate);
    const ok = window.confirm(
      `Cancel the week of ${label}?\n\n` +
        '• That Monday is removed from the 8-week intake list.\n' +
        '• Every later Monday moves one calendar week forward; a new 8th Monday is added at the end.\n' +
        '• Any game night on that date is deleted (scores lost).\n' +
        '• Other game nights move forward with their data.\n' +
        '• Player availability for every shifted or new Monday is cleared (unchecked) until you set it again.\n\n' +
        'This cannot be undone from the app.'
    );
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await rpcAdminCancelAndShiftIntakeWeek(slug, cancelWeekDate);
      setCancelWeekDate('');
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function addPlayoffWalkOn(e: React.FormEvent) {
    e.preventDefault();
    if (!slug || !playoffWalkOnName.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await rpcAdminAddPlayer(slug, playoffWalkOnName.trim(), true, false);
      setPlayoffWalkOnName('');
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function generatePlayoffPools() {
    if (!slug || !season || !playoffDate) {
      setErr('Choose a playoff date.');
      return;
    }
    if (playoffPoolCount < 2 || playoffPoolCount > 4) {
      setErr('Pools must be between 2 and 4.');
      return;
    }
    if (playoffRrGames < 3 || playoffRrGames > 5) {
      setErr('Round-robin games per team must be between 3 and 5.');
      return;
    }

    setBusy(true);
    setErr(null);
    setPlayoffOk(null);
    try {
      const nightId =
        nights.find((n) => n.night_date === playoffDate)?.id ??
        (await rpcAdminCreateGameNight(slug, playoffDate, null));

      const attendingIds = players
        .filter((p) => playoffRoster[p.id] === true)
        .map((p) => p.id);

      if (attendingIds.length < 8) {
        setErr(
          'Playoffs need at least 8 checked players (4 teams). Add walk-ons or check more names.'
        );
        return;
      }
      if (attendingIds.length % 2 !== 0) {
        setErr('Playoffs need an even player count (no sit-outs for seeding).');
        return;
      }
      const teamCount = attendingIds.length / 2;
      if (teamCount < playoffPoolCount * 2) {
        setErr(
          `Not enough teams for ${playoffPoolCount} pools (need at least ${playoffPoolCount * 2} teams).`
        );
        return;
      }

      const scored = await fetchAllScoredMatchesForSeason(season.id);
      const rankedIds = rankPlayerIdsForPlayoffSeeding(players, scored);
      const payload = buildPlayoffPoolMatchPayload(
        attendingIds,
        rankedIds,
        playoffPoolCount,
        playoffRrGames
      );
      await rpcSaveStageMatches(nightId, 'playoffs_pool', payload);
      await Promise.all(
        players.map((p) =>
          rpcSetAttendance(nightId, p.id, playoffRoster[p.id] === true)
        )
      );
      setPlayoffOk(nightId);
      await loadPlayoffMatchesForSelectedDate();
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function generatePlayoffBrackets() {
    if (!slug || !playoffDate) {
      setErr('Choose a playoff date first.');
      return;
    }
    if (playoffGoldPerPool < 0 || playoffSilverPerPool < 0) {
      setErr('Qualifier counts must be 0 or higher.');
      return;
    }

    setBusy(true);
    setErr(null);
    setPlayoffOk(null);
    try {
      const nightId =
        nights.find((n) => n.night_date === playoffDate)?.id ??
        (await rpcAdminCreateGameNight(slug, playoffDate, null));

      const all = await fetchMatchesForNight(nightId);
      const poolMatches = all.filter((m) => m.stage === 'playoffs_pool');
      if (poolMatches.length === 0) {
        setErr('No pool matches found for that night. Generate pools first.');
        return;
      }
      const unscored = poolMatches.filter(
        (m) => m.score_a == null || m.score_b == null
      );
      if (unscored.length > 0) {
        setErr(
          `Enter all pool scores first (${unscored.length} pool match${
            unscored.length === 1 ? '' : 'es'
          } missing scores).`
        );
        return;
      }

      const standingsByPool = computePoolStandingsFromMatches(poolMatches);
      const { gold, silver } = selectBracketSeedsFromPools({
        standingsByPool,
        totalGold: playoffGoldPerPool,
        totalSilver: playoffSilverPerPool,
      });

      if (playoffGoldPerPool > 0 && gold.length < 2) {
        setErr('Not enough gold qualifiers to build a bracket.');
        return;
      }
      if (playoffSilverPerPool > 0 && silver.length < 2) {
        setErr('Not enough silver qualifiers to build a bracket.');
        return;
      }

      if (playoffGoldPerPool > 0) {
        const goldPayload = buildSingleElimRound1Matches(gold, 'gold');
        await rpcSaveStageMatches(nightId, 'playoffs_gold', goldPayload);
      }
      if (playoffSilverPerPool > 0) {
        const silverPayload = buildSingleElimRound1Matches(silver, 'silver');
        await rpcSaveStageMatches(nightId, 'playoffs_silver', silverPayload);
      }

      setPlayoffOk(nightId);
      await loadPlayoffMatchesForSelectedDate();
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  if (!slug) {
    return (
      <Layout title="Admin">
        <p>Invalid admin link.</p>
      </Layout>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <Layout title="Admin">
        <ConfigBanner />
      </Layout>
    );
  }

  if (season === undefined) {
    return (
      <Layout title="Admin">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  if (season === null) {
    return (
      <Layout title="Admin">
        <p>Season not found.</p>
      </Layout>
    );
  }

  const joinUrl = `${window.location.origin}/league/${slug}/join`;
  const intakeDateSet = new Set(intakeMondays.map((m) => m.monday_date));
  // Only show the 8 league-week nights here (playoff nights live on the Playoffs tab).
  const leagueNights = nights
    .filter((n) => intakeDateSet.has(n.night_date))
    .sort((a, b) => a.night_date.localeCompare(b.night_date));
  const scheduledNightDates = new Set(nights.map((n) => n.night_date));
  /** Intake Mondays that do not yet have a game night (includes past dates for retroactive setup). */
  const intakeMondaysNeedingNight = intakeMondays
    .map((m) => m.monday_date)
    .filter((d) => !scheduledNightDates.has(d))
    .sort((a, b) => a.localeCompare(b));

  return (
    <Layout
      title={season.name}
      subtitle="Organizer dashboard"
      actions={
        <a className="btn small secondary" href={joinUrl}>
          Player link
        </a>
      }
    >
      {err ? <p className="error banner-inline">{err}</p> : null}

      <div className="tabs">
        <button
          type="button"
          className={tab === 'players' ? 'tab active' : 'tab'}
          onClick={() => setTab('players')}
        >
          Roster
        </button>
        <button
          type="button"
          className={tab === 'nights' ? 'tab active' : 'tab'}
          onClick={() => setTab('nights')}
        >
          Game nights
        </button>
        <button
          type="button"
          className={tab === 'playoffs' ? 'tab active' : 'tab'}
          onClick={() => setTab('playoffs')}
        >
          Playoffs
        </button>
        <button
          type="button"
          className={tab === 'standings' ? 'tab active' : 'tab'}
          onClick={() => setTab('standings')}
        >
          Standings
        </button>
        <button
          type="button"
          className={tab === 'settings' ? 'tab active' : 'tab'}
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
      </div>

      {tab === 'players' ? (
        <section className="card">
          <h2>Roster</h2>
          <p className="hint">
            Intake adds players here. Toggle attendance per night on each game
            night page.
          </p>
          <ul className="list">
            {players.map((p) => (
              <li key={p.id} className="list-row">
                <span>
                  <strong>{p.display_name}</strong>
                </span>
                <span className="actions-row" style={{ margin: 0 }}>
                  <button
                    type="button"
                    className="btn text"
                    disabled={busy}
                    onClick={() => openEditPlayer(p)}
                  >
                    Edit name
                  </button>
                  <button
                    type="button"
                    className="btn text danger"
                    disabled={busy}
                    onClick={() => removePlayer(p.id)}
                  >
                    Remove
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <form className="form inline" onSubmit={addPlayer}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Add walk-on name"
            />
            <button className="btn secondary" type="submit" disabled={busy}>
              Add player
            </button>
          </form>
        </section>
      ) : null}

      {editPlayerId ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal card">
            <div className="modal-head">
              <h2>Edit player name</h2>
              <button
                type="button"
                className="btn text"
                disabled={busy || editPlayerBusy}
                onClick={() => {
                  setEditPlayerId(null);
                  setEditPlayerDraft('');
                  setErr(null);
                }}
              >
                Close
              </button>
            </div>
            <p className="hint">This changes the name displayed everywhere for this season.</p>
            {err ? <p className="error">{err}</p> : null}
            <label className="field">
              <span>Name</span>
              <input
                value={editPlayerDraft}
                onChange={(e) => setEditPlayerDraft(e.target.value)}
                disabled={busy || editPlayerBusy}
                autoFocus
              />
            </label>
            <div className="actions-row">
              <button
                type="button"
                className="btn primary"
                disabled={busy || editPlayerBusy || !editPlayerDraft.trim()}
                onClick={() => void saveEditPlayer()}
              >
                {editPlayerBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'nights' ? (
        <section className="card">
          <h2>Game nights</h2>
          <p className="hint">
            Create nights from your eight intake Mondays. Past Mondays stay listed
            until a night exists so you can add them retroactively. Match generation
            auto-sizes courts based on who is attending.
          </p>
          <div className="stack" style={{ marginBottom: '1rem' }}>
            {intakeMondaysNeedingNight.length === 0 ? (
              <p className="muted">
                Every intake Monday already has a game night, or configure Mondays
                in Settings.
              </p>
            ) : (
              intakeMondaysNeedingNight.map((date) => (
                <div key={date} className="list-row">
                  <span>{formatOrdinalLongDate(date)}</span>
                  <button
                    className="btn small secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => addNight(date)}
                  >
                    Create night
                  </button>
                </div>
              ))
            )}
          </div>
          <ul className="list">
            {leagueNights.map((n) => (
              <li key={n.id} className="list-row">
                <span>
                  <strong>{formatOrdinalLongDate(n.night_date)}</strong>
                </span>
                <Link
                  className="btn small primary"
                  to={`/league/${slug}/admin/night/${n.id}`}
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {tab === 'playoffs' ? (
        <section className="card">
          <h2>Playoff pool play</h2>
          <p className="hint">
            Playoffs are separate from the eight regular weeks. Pick the playoff
            date (roster checkboxes load from that night’s attendance when it
            already exists), adjust who’s in, add walk-ons if needed, then
            generate pools. Seeding uses season results; anyone with no games
            played yet is ranked last. After generate, attendance on that night
            matches your checkboxes.
          </p>
          {playoffOk ? (
            <p className="hint" style={{ marginBottom: '1rem' }}>
              Pool schedule saved.{' '}
              <Link
                className="btn small primary"
                to={`/league/${slug}/admin/night/${playoffOk}`}
              >
                Open game night
              </Link>
            </p>
          ) : null}
          <div className="stack">
            <label className="field">
              <span>Playoff date</span>
              <input
                type="date"
                value={playoffDate}
                onChange={(e) => {
                  const d = e.target.value;
                  setPlayoffDate(d);
                  setPlayoffOk(null);
                  void hydratePlayoffRosterForDate(d);
                }}
              />
            </label>
            {playoffDate ? (
              <p className="muted" style={{ marginTop: 0 }}>
                {formatOrdinalLongDate(playoffDate)}
                {scheduledNightDates.has(playoffDate)
                  ? ' — night already exists; pool matches will be saved to it.'
                  : ' — a new game night will be created for this date.'}
              </p>
            ) : null}

            <button
              type="button"
              className="btn secondary"
              disabled={busy || !playoffDate}
              onClick={() => void openPlayoffNight()}
            >
              {busy ? 'Working…' : 'Open playoff game night'}
            </button>
            {!playoffsGenerated ? (
              <>
                <div>
                  <h3 style={{ marginBottom: '0.5rem', fontSize: '1.05rem' }}>
                    Playoff roster (
                    {players.filter((p) => playoffRoster[p.id] !== false).length})
                  </h3>
                  <p className="hint" style={{ marginTop: 0 }}>
                    Checked players are seeded and scheduled. Changing the date
                    reloads checks from that night’s attendance (or all on for a new
                    date).
                  </p>
                  <ul className="list check-list">
                    {players.map((p) => (
                      <li key={p.id} className="list-row">
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={playoffRoster[p.id] !== false}
                            disabled={busy}
                            onChange={(e) => {
                              setPlayoffRoster((prev) => ({
                                ...prev,
                                [p.id]: e.target.checked,
                              }));
                              setPlayoffOk(null);
                            }}
                          />
                          {p.display_name}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <form className="form inline" onSubmit={addPlayoffWalkOn}>
                    <input
                      value={playoffWalkOnName}
                      onChange={(e) => setPlayoffWalkOnName(e.target.value)}
                      placeholder="Add new player for playoffs"
                      disabled={busy}
                    />
                    <button className="btn secondary" type="submit" disabled={busy}>
                      Add to season
                    </button>
                  </form>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Pools (2–4)</span>
                    <input
                      type="number"
                      min={2}
                      max={4}
                      value={playoffPoolCount}
                      disabled={busy}
                      onChange={(e) => setPlayoffPoolCount(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span>RR games / team (3–5)</span>
                    <input
                      type="number"
                      min={3}
                      max={5}
                      value={playoffRrGames}
                      disabled={busy}
                      onChange={(e) => setPlayoffRrGames(Number(e.target.value))}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || !playoffDate}
                  onClick={() => void generatePlayoffPools()}
                >
                  {busy ? 'Working…' : 'Create night (if needed) & generate pools'}
                </button>
              </>
            ) : null}

            {playoffsGenerated ? (
              <>
                <p className="hint" style={{ marginBottom: 0 }}>
                  Brackets seed as Pool A #1, Pool B #1, … then Pool A #2, Pool B #2, …
                </p>
                <div className="field-row">
                  <label className="field">
                    <span>Gold teams (total)</span>
                    <input
                      type="number"
                      min={0}
                      max={8}
                      value={playoffGoldPerPool}
                      disabled={busy}
                      onChange={(e) => setPlayoffGoldPerPool(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    <span>Silver teams (total)</span>
                    <input
                      type="number"
                      min={0}
                      max={8}
                      value={playoffSilverPerPool}
                      disabled={busy}
                      onChange={(e) => setPlayoffSilverPerPool(Number(e.target.value))}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy || !playoffDate}
                  onClick={() => void generatePlayoffBrackets()}
                >
                  {busy ? 'Working…' : 'Generate gold/silver brackets (Round 1)'}
                </button>
              </>
            ) : null}

            {playoffMatchesLoading ? (
              <p className="muted">Loading saved playoff matches…</p>
            ) : playoffNightId ? (
              playoffPoolMatches.length === 0 &&
              playoffGoldMatches.length === 0 &&
              playoffSilverMatches.length === 0 ? (
                <p className="muted">No saved playoff matches yet for this date.</p>
              ) : (
                <div className="stack" style={{ marginTop: '0.75rem' }}>
                  <p className="hint" style={{ marginTop: 0 }}>
                    Saved: {playoffPoolMatches.length} pool · {playoffGoldMatches.length}{' '}
                    gold · {playoffSilverMatches.length} silver matches
                  </p>
                  {playoffPoolMatches.length > 0 ? (
                    <>
                      <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Pools &amp; standings</h3>
                      {playoffPoolIndices.map((pi) => {
                        const rows = playoffStandingsByPool.get(pi) ?? [];
                        return (
                          <div key={pi} className="table-wrap">
                            <h4 style={{ margin: '0.5rem 0' }}>
                              {`Pool ${String.fromCharCode(65 + pi)}`}
                            </h4>
                            <table className="table">
                              <thead>
                                <tr>
                                  <th>Team</th>
                                  <th>W</th>
                                  <th>L</th>
                                  <th>PF</th>
                                  <th>PA</th>
                                  <th>+/-</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r) => (
                                  <tr key={`${r.p1}-${r.p2}`}>
                                    <td>{`${nameById.get(r.p1) ?? r.p1} & ${nameById.get(r.p2) ?? r.p2}`}</td>
                                    <td>{r.wins}</td>
                                    <td>{r.losses}</td>
                                    <td>{r.pointsFor}</td>
                                    <td>{r.pointsAgainst}</td>
                                    <td>{r.pointDiff}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })}
                      <p className="hint" style={{ marginTop: 0 }}>
                        Tip: brackets require all pool scores entered first.
                      </p>
                    </>
                  ) : null}
                </div>
              )
            ) : null}

            {playoffsGenerated ? (
              <div className="fieldset" style={{ marginTop: '1rem' }}>
                <legend>Reset</legend>
                <p className="hint" style={{ marginTop: 0 }}>
                  Use only if you need to redo playoffs. This deletes all playoff matches
                  (pool + gold + silver) for the selected date.
                </p>
                <button
                  type="button"
                  className="btn danger"
                  disabled={busy || !playoffDate}
                  onClick={() => void resetPlayoffs()}
                >
                  Reset playoffs for this date
                </button>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === 'standings' ? (
        <section className="card">
          <h2>Season standings</h2>
          <p className="hint">
            Sorted by win percentage, then games played (tiebreak), then point
            differential. Point diff is points for minus against.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>W</th>
                  <th>L</th>
                  <th>Pct</th>
                  <th>PF</th>
                  <th>PA</th>
                  <th>+/-</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row) => (
                  <tr key={row.playerId}>
                    <td>{row.name}</td>
                    <td>{row.wins}</td>
                    <td>{row.losses}</td>
                    <td>{formatWinPctDisplay(row.winPct)}</td>
                    <td>{row.pointsFor}</td>
                    <td>{row.pointsAgainst}</td>
                    <td>{row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {standings.length === 0 ? (
              <p className="muted">No scored matches yet.</p>
            ) : null}
          </div>
        </section>
      ) : null}
      {tab === 'settings' ? (
        <>
          <section className="card">
            <h2>Default season (home page)</h2>
            <p className="hint">
              When you visit the league home page while signed in, the season
              menu pre-selects this season. Saved per organizer account in this
              browser (not synced across devices).
            </p>
            {session?.user?.id ? (
              <div className="stack">
                <label className="field">
                  <span>Season</span>
                  <select
                    value={defaultSeasonDraft}
                    onChange={(e) => {
                      setDefaultSeasonDraft(e.target.value);
                      setDefaultSeasonSaved(false);
                    }}
                  >
                    {seasonsForDefaultPicker.map((s) => (
                      <option key={s.id} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || seasonsForDefaultPicker.length === 0}
                  onClick={saveDefaultSeasonPreference}
                >
                  Save default season
                </button>
                {defaultSeasonSaved ? (
                  <p className="hint" style={{ marginBottom: 0 }}>
                    Saved. Open the league home to see the season pre-selected.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="muted">Sign in to set your default season.</p>
            )}
          </section>
          <section className="card">
            <h2>Public home page</h2>
            <p className="hint">
              Logged-out visitors normally see every season on the league home
              page. Turn this on to hide only this season from them (standings,
              recap, announcements). The player join link still works for anyone
              who has the URL.
            </p>
            <div className="stack">
              <label className="check">
                <input
                  type="checkbox"
                  checked={hideFromPublic}
                  onChange={(e) => setHideFromPublic(e.target.checked)}
                  disabled={hideFromPublicBusy || busy}
                />
                Hide this season from logged-out visitors
              </label>
              <button
                type="button"
                className="btn secondary"
                disabled={hideFromPublicBusy || busy}
                onClick={() => void saveSeasonVisibility()}
              >
                {hideFromPublicBusy ? 'Saving…' : 'Save visibility'}
              </button>
            </div>
          </section>
          <section className="card">
            <h2>Announcements</h2>
            <form className="form inline" onSubmit={addAnnouncement}>
              <input
                value={announcementText}
                onChange={(e) => setAnnouncementText(e.target.value)}
                placeholder="Add league announcement"
              />
              <button className="btn secondary" type="submit" disabled={busy}>
                Add
              </button>
            </form>
            <ul className="list">
              {announcements.map((a) => (
                <li key={a.id} className="list-row">
                  <span>{a.message}</span>
                  <button
                    type="button"
                    className="btn text danger"
                    disabled={busy}
                    onClick={() => removeAnnouncement(a.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2>Anonymous feedback</h2>
            <p className="hint">
              Messages sent from the league home page (Feedback section). Newest
              first.
            </p>
            {leagueFeedback.length === 0 ? (
              <p className="muted">No feedback yet.</p>
            ) : (
              <ul className="list">
                {leagueFeedback.map((f) => (
                  <li key={f.id} className="list-row left">
                    <span>
                      <strong>
                        {new Date(f.created_at).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </strong>
                      <div style={{ marginTop: '0.35rem', whiteSpace: 'pre-wrap' }}>
                        {f.message}
                      </div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h2>Intake Mondays (next 8)</h2>
            <p className="hint">
              These dates power the player intake form and can be adjusted any
              time.
            </p>
            <div className="stack">
              {intakeMondays.map((m, idx) => (
                <label className="field" key={`${m.season_id}-${idx}`}>
                  <span>Monday {idx + 1}</span>
                  <input
                    type="date"
                    value={m.monday_date}
                    onChange={(e) =>
                      setIntakeMondays((prev) =>
                        prev.map((row, i) =>
                          i === idx ? { ...row, monday_date: e.target.value } : row
                        )
                      )
                    }
                  />
                </label>
              ))}
              <button className="btn primary" type="button" onClick={saveMondays}>
                Save Monday dates
              </button>
            </div>
          </section>
          <section className="card">
            <h2>Cancel a week &amp; shift schedule</h2>
            <p className="hint">
              Use when play is canceled for one Monday but you still want eight
              league weeks. Later Mondays move forward a week and a new final
              Monday is added. Availability for those moved/new Mondays is
              cleared for every player—re-check attendance on game night pages
              or have players update intake if you reopen it.
            </p>
            {intakeMondays.length !== 8 ? (
              <p className="muted">
                Requires exactly eight intake Mondays (save settings above
                first).
              </p>
            ) : (
              <div className="stack">
                <label className="field">
                  <span>Monday to cancel</span>
                  <select
                    value={cancelWeekDate}
                    onChange={(e) => setCancelWeekDate(e.target.value)}
                  >
                    <option value="">Select a Monday…</option>
                    {intakeMondays.map((m) => (
                      <option key={m.monday_date} value={m.monday_date}>
                        {formatOrdinalLongDate(m.monday_date)} ({m.monday_date})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy || !cancelWeekDate}
                  onClick={() => void cancelAndShiftWeek()}
                >
                  Cancel this week &amp; shift the rest
                </button>
              </div>
            )}
          </section>
        </>
      ) : null}
    </Layout>
  );
}
