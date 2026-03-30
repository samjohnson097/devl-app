import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchAllScoredMatchesForSeason,
  fetchAnnouncements,
  fetchGameNights,
  fetchPlayers,
  fetchSeasons,
  fetchSeasonBySlug,
  fetchMatchesForNights,
  fetchSeasonIntakeMondays,
  rpcCreateSeason,
  rpcSubmitLeagueFeedback,
  type MatchRow,
} from '../api/leagueApi';
import { useAuth } from '../auth/AuthContext';
import { withJwtRetry } from '../auth/sessionRefresh';
import { formatAppError } from '../lib/errors';
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import { MatchRecapSection, type NightRecap } from '../components/MatchRecapSection';
import { ConfigBanner, Layout } from '../components/Layout';
import {
  formatOrdinalLongDate,
  localIsoDateString,
  weekdayLong,
} from '../lib/dates';
import { computeStandings } from '../lib/standings';
import { getDefaultSeasonSlug } from '../lib/adminPreferences';

type IntakeDateRow = {
  iso: string;
  display: string;
  weekday: string;
  scoresComplete: boolean;
};

function sortMatchesForDisplay(matches: MatchRow[]): MatchRow[] {
  return matches.slice().sort((a, b) =>
    a.round_index !== b.round_index
      ? a.round_index - b.round_index
      : a.court_index - b.court_index
  );
}

export function HomePage() {
  const { session, signOut } = useAuth();
  const [seasons, setSeasons] = useState<
    Array<{ id: string; slug: string; name: string }>
  >([]);
  const [selectedSlug, setSelectedSlug] = useState<string>('');
  const [selectedSeasonName, setSelectedSeasonName] = useState<string>('');
  const [intakeDateRows, setIntakeDateRows] = useState<IntakeDateRow[]>([]);
  const [announcements, setAnnouncements] = useState<
    Array<{ id: string; message: string; created_at: string }>
  >([]);
  const [matchupRecap, setMatchupRecap] = useState<{
    nights: NightRecap[];
    recentNightsChecked: number;
  }>({ nights: [], recentNightsChecked: 0 });
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [standings, setStandings] = useState<
    ReturnType<typeof computeStandings>
  >([]);
  const [name, setName] = useState('');
  const [games, setGames] = useState(5);
  const [firstMonday, setFirstMonday] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string } | null>(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackOk, setFeedbackOk] = useState<string | null>(null);
  const [feedbackErr, setFeedbackErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    (async () => {
      try {
        const sb = requireSupabase();
        const list = await withJwtRetry(sb, () => fetchSeasons());
        setSeasons(list.map((s) => ({ id: s.id, slug: s.slug, name: s.name })));
      } catch (er: unknown) {
        setErr(formatAppError(er));
      }
    })();
  }, []);

  useEffect(() => {
    if (seasons.length === 0) return;
    const uid = session?.user?.id;
    if (uid) {
      const saved = getDefaultSeasonSlug(uid);
      if (saved && seasons.some((s) => s.slug === saved)) {
        setSelectedSlug(saved);
        return;
      }
    }
    setSelectedSlug((prev) =>
      prev && seasons.some((s) => s.slug === prev) ? prev : seasons[0].slug
    );
  }, [seasons, session?.user?.id]);

  useEffect(() => {
    setFeedbackOk(null);
    setFeedbackErr(null);
  }, [selectedSlug]);

  async function onSubmitFeedback(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedSlug || !isSupabaseConfigured) return;
    const msg = feedbackText.trim();
    if (!msg) {
      setFeedbackErr('Please enter a message.');
      return;
    }
    setFeedbackBusy(true);
    setFeedbackErr(null);
    setFeedbackOk(null);
    try {
      const sb = requireSupabase();
      await withJwtRetry(sb, () =>
        rpcSubmitLeagueFeedback(selectedSlug, feedbackText)
      );
      setFeedbackText('');
      setFeedbackOk(
        'Thanks — your message was sent to the league organizers anonymously.'
      );
    } catch (er: unknown) {
      setFeedbackErr(formatAppError(er));
    } finally {
      setFeedbackBusy(false);
    }
  }

  const reloadSelectedSeason = useCallback(async () => {
    if (!selectedSlug || !isSupabaseConfigured) return;
    try {
      const sb = requireSupabase();
      const s = await withJwtRetry(sb, () => fetchSeasonBySlug(selectedSlug));
      if (!s) return;
      setSelectedSeasonName(s.name);
      const [mons, anns, players, nights, scored] = await withJwtRetry(
        sb,
        () =>
          Promise.all([
            fetchSeasonIntakeMondays(s.id),
            fetchAnnouncements(s.id),
            fetchPlayers(s.id),
            fetchGameNights(s.id),
            fetchAllScoredMatchesForSeason(s.id),
          ])
      );
      const nightIds = nights.map((n) => n.id);
      const allNightMatches = await withJwtRetry(sb, () =>
        fetchMatchesForNights(nightIds)
      );
      const matchesByNightId = new Map<string, MatchRow[]>();
      for (const m of allNightMatches) {
        const cur = matchesByNightId.get(m.game_night_id) ?? [];
        cur.push(m);
        matchesByNightId.set(m.game_night_id, cur);
      }
      const completeByNightDate = new Map<string, boolean>();
      for (const n of nights) {
        const ms = matchesByNightId.get(n.id) ?? [];
        completeByNightDate.set(
          n.night_date,
          ms.length > 0 && ms.every((x) => x.score_a != null && x.score_b != null)
        );
      }
      setIntakeDateRows(
        mons.map((m) => ({
          iso: m.monday_date,
          display: formatOrdinalLongDate(m.monday_date),
          weekday: weekdayLong(m.monday_date),
          scoresComplete: completeByNightDate.get(m.monday_date) ?? false,
        }))
      );
      setAnnouncements(anns);
      const byId = new Map(players.map((p) => [p.id, p.display_name]));
      setNameById(byId);
      setStandings(computeStandings(players, scored));

      const todayIso = localIsoDateString();
      const RECAP_NIGHT_LIMIT = 12;

      const matchesFor = (nightId: string) => matchesByNightId.get(nightId) ?? [];

      const nightFullyScored = (nightId: string) => {
        const ms = matchesFor(nightId);
        return ms.length > 0 && ms.every((x) => x.score_a != null && x.score_b != null);
      };

      /** Past/today nights, or any night already fully scored (so future placeholders do not hide completed weeks). */
      const recapNights: NightRecap[] = nights
        .filter((n) => {
          const ms = matchesFor(n.id);
          if (ms.length === 0) return false;
          return n.night_date <= todayIso || nightFullyScored(n.id);
        })
        .slice(0, RECAP_NIGHT_LIMIT)
        .map((n) => ({
          id: n.id,
          date: n.night_date,
          matches: sortMatchesForDisplay(matchesFor(n.id)),
        }));

      setMatchupRecap({
        nights: recapNights,
        recentNightsChecked: nights.length,
      });
    } catch (er: unknown) {
      setErr(formatAppError(er));
    }
  }, [selectedSlug]);

  useEffect(() => {
    void reloadSelectedSeason();
  }, [reloadSelectedSeason]);

  useEffect(() => {
    if (!selectedSlug || !isSupabaseConfigured) return;
    const onFocus = () => void reloadSelectedSeason();
    const onVis = () => {
      if (document.visibilityState === 'visible') void reloadSelectedSeason();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [selectedSlug, reloadSelectedSeason]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const sb = requireSupabase();
      const row = await withJwtRetry(sb, () =>
        rpcCreateSeason(name.trim(), 4, games, firstMonday || null)
      );
      setCreated({ slug: row.slug });
      setName('');
      setFirstMonday('');
      const list = await fetchSeasons();
      setSeasons(list.map((s) => ({ id: s.id, slug: s.slug, name: s.name })));
      if (row.slug) setSelectedSlug(row.slug);
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      title="DEVL"
      subtitle="Announcements, season recap, matchups, and standings."
    >
      {!isSupabaseConfigured ? <ConfigBanner /> : null}
      <div className="home-grid">
        <aside className="sidebar card">
          <h2>League menu</h2>
          <label className="field">
            <span>Season</span>
            <select
              value={selectedSlug}
              onChange={(e) => setSelectedSlug(e.target.value)}
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {selectedSlug ? (
            <div className="stack">
              <label className="label">New player intake form</label>
              <Link className="btn secondary" to={`/league/${selectedSlug}/join`}>
                Open intake form
              </Link>
            </div>
          ) : null}
          <div className="divider" />
          {session ? (
            <>
              <div className="stack">
                <label className="label">Organizer</label>
                {selectedSlug ? (
                  <Link
                    className="btn secondary"
                    to={`/league/${selectedSlug}/admin`}
                  >
                    Season admin
                  </Link>
                ) : null}
                <button
                  type="button"
                  className="btn text"
                  onClick={() => signOut()}
                >
                  Sign out
                </button>
              </div>
              <div className="divider" />
              <h3>Create season</h3>
              <form className="form" onSubmit={onCreate}>
                <label className="field">
                  <span>Season name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Spring 2026 Monday league"
                    required
                    minLength={2}
                  />
                </label>
                <div className="field-row">
                  <label className="field">
                    <span>Games / player</span>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={games}
                      onChange={(e) => setGames(Number(e.target.value))}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>First Monday for intake dates</span>
                  <input
                    type="date"
                    value={firstMonday}
                    onChange={(e) => setFirstMonday(e.target.value)}
                    required
                  />
                </label>
                <button
                  className="btn primary"
                  type="submit"
                  disabled={busy || !isSupabaseConfigured}
                >
                  {busy ? 'Creating…' : 'Create season'}
                </button>
              </form>
            </>
          ) : (
            <div className="stack">
              <label className="label">Organizer</label>
              <Link className="btn secondary" to="/admin/login">
                Sign in to manage seasons
              </Link>
            </div>
          )}
        </aside>

        <div className="main-column">
          {created ? (
            <section className="card success-card">
              <h2>Season created</h2>
              <p className="muted">
                Share the intake link with players. Manage the season from the
                organizer dashboard (signed in).
              </p>
              <div className="stack">
                <label className="label">Player intake</label>
                <Link
                  className="link-block"
                  to={`/league/${created.slug}/join`}
                >{`${window.location.origin}/league/${created.slug}/join`}</Link>
              </div>
              <p className="actions-row">
                <Link
                  className="btn secondary"
                  to={`/league/${created.slug}/admin`}
                >
                  Open season admin
                </Link>
              </p>
            </section>
          ) : null}

          {err ? <p className="error">{err}</p> : null}
          <section className="card">
            <h2>Announcements</h2>
            {announcements.length === 0 ? (
              <p className="muted">No announcements yet.</p>
            ) : (
              <ul className="list">
                {announcements.map((a) => (
                  <li key={a.id} className="list-row left">
                    <span>
                      <strong>{new Date(a.created_at).toLocaleDateString()}</strong>
                      <div>{a.message}</div>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card season-card">
            <h2>{selectedSeasonName || 'Current season'}</h2>
            <p className="season-card-lead muted">
              Monday game nights for this season. 
            </p>
            {intakeDateRows.length === 0 ? (
              <p className="muted season-card-empty">
                No intake dates configured yet.
              </p>
            ) : (
              <ul className="season-date-list" aria-label="Season Monday dates">
                {intakeDateRows.map((row) => (
                  <li
                    key={row.iso}
                    className={`season-date-row${
                      row.scoresComplete ? ' season-date-row--complete' : ''
                    }`}
                  >
                    <div className="season-date-copy">
                      <span className="season-date-weekday">{row.weekday}</span>
                      <span className="season-date-primary">{row.display}</span>
                    </div>
                    {row.scoresComplete ? (
                      <span
                        className="season-date-check"
                        title="All scores entered"
                        aria-label={`All scores entered for ${row.display}`}
                      >
                        ✓
                      </span>
                    ) : (
                      <span
                        className="season-date-pending"
                        aria-hidden="true"
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <MatchRecapSection
            nights={matchupRecap.nights}
            nameById={nameById}
            recentNightsChecked={matchupRecap.recentNightsChecked}
          />

          <section className="card">
            <h2>Overall standings</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Player</th>
                    <th>W</th>
                    <th>L</th>
                    <th>+/-</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row) => (
                    <tr key={row.playerId}>
                      <td>{row.name}</td>
                      <td>{row.wins}</td>
                      <td>{row.losses}</td>
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

          <section className="card">
            <h2>Feedback</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Send anonymous feedback to the organizers for the season selected
              above. You do not need to sign in.
            </p>
            {!selectedSlug ? (
              <p className="muted">Choose a season from the menu to send feedback.</p>
            ) : (
              <form className="form" onSubmit={onSubmitFeedback}>
                <label className="field">
                  <span>Message</span>
                  <textarea
                    value={feedbackText}
                    onChange={(e) => {
                      setFeedbackText(e.target.value);
                      setFeedbackOk(null);
                      setFeedbackErr(null);
                    }}
                    rows={4}
                    maxLength={2000}
                    placeholder="Suggestions, concerns, or thanks…"
                    disabled={feedbackBusy || !isSupabaseConfigured}
                  />
                </label>
                {feedbackErr ? (
                  <p className="error" style={{ marginTop: 0 }}>
                    {feedbackErr}
                  </p>
                ) : null}
                {feedbackOk ? (
                  <p className="hint" style={{ marginTop: 0 }}>
                    {feedbackOk}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className="btn primary"
                  disabled={
                    feedbackBusy || !isSupabaseConfigured || !feedbackText.trim()
                  }
                >
                  {feedbackBusy ? 'Sending…' : 'Send feedback'}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </Layout>
  );
}
