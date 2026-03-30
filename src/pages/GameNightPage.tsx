import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchAttendance,
  fetchGameNightById,
  fetchMatchesForNight,
  fetchPlayers,
  fetchPriorMatchLikeForSeason,
  fetchSeasonBySlug,
  rpcSaveSchedule,
  rpcAdminUpdateMatchPlayers,
  rpcSetAttendance,
  rpcSetMatchScore,
  type MatchRow,
  type PlayerRow,
  type SeasonRow,
} from '../api/leagueApi';
import { buildSchedule } from '../lib/schedule';
import { isSupabaseConfigured } from '../lib/supabase';
import { ConfigBanner, Layout } from '../components/Layout';
import { formatAppError } from '../lib/errors';

export function GameNightPage() {
  const { slug, nightId } = useParams<{
    slug: string;
    nightId: string;
  }>();
  const [season, setSeason] = useState<SeasonRow | null>(null);
  const [night, setNight] = useState<Awaited<
    ReturnType<typeof fetchGameNightById>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [scoreDraft, setScoreDraft] = useState<
    Record<string, { a: string; b: string }>
  >({});
  const [editing, setEditing] = useState<{
    matchId: string;
    slot:
      | 'team_a_p1'
      | 'team_a_p2'
      | 'team_a_p3'
      | 'team_b_p1'
      | 'team_b_p2'
      | 'team_b_p3';
    playerId: string;
  } | null>(null);
  const [conflictRound, setConflictRound] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [scheduleView, setScheduleView] = useState<
    'regular' | 'playoffs_pool' | 'playoffs_gold' | 'playoffs_silver'
  >('regular');

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.display_name);
    return m;
  }, [players]);

  const hasPlayoffMatches = useMemo(
    () =>
      matches.some(
        (m) =>
          m.stage === 'playoffs_pool' ||
          m.stage === 'playoffs_gold' ||
          m.stage === 'playoffs_silver'
      ),
    [matches]
  );

  useEffect(() => {
    if (
      scheduleView !== 'regular' &&
      !matches.some((m) => m.stage === scheduleView)
    ) {
      setScheduleView('regular');
    }
  }, [matches, scheduleView]);

  function idsInMatch(m: MatchRow): string[] {
    return [
      m.team_a_p1,
      m.team_a_p2,
      m.team_a_p3,
      m.team_b_p1,
      m.team_b_p2,
      m.team_b_p3,
    ].filter(Boolean) as string[];
  }

  const roundKeyFor = useCallback(
    (m: MatchRow): number => {
      if (scheduleView !== 'regular') return m.stage_round ?? m.round_index;
      return m.round_index;
    },
    [scheduleView]
  );

  type SlotKey =
    | 'team_a_p1'
    | 'team_a_p2'
    | 'team_a_p3'
    | 'team_b_p1'
    | 'team_b_p2'
    | 'team_b_p3';

  function slotForPlayer(m: MatchRow, playerId: string): SlotKey | null {
    if (m.team_a_p1 === playerId) return 'team_a_p1';
    if (m.team_a_p2 === playerId) return 'team_a_p2';
    if (m.team_a_p3 === playerId) return 'team_a_p3';
    if (m.team_b_p1 === playerId) return 'team_b_p1';
    if (m.team_b_p2 === playerId) return 'team_b_p2';
    if (m.team_b_p3 === playerId) return 'team_b_p3';
    return null;
  }

  const visibleMatches = useMemo(() => {
    if (scheduleView !== 'regular') {
      return matches.filter((m) => m.stage === scheduleView);
    }
    // regular view includes anything not explicitly playoffs (backwards compatible)
    return matches.filter((m) => !m.stage || m.stage === 'regular');
  }, [matches, scheduleView]);

  const conflictDupByRound = useMemo(() => {
    const byRound = new Map<number, MatchRow[]>();
    for (const m of visibleMatches) {
      const rk = roundKeyFor(m);
      const list = byRound.get(rk) ?? [];
      list.push(m);
      byRound.set(rk, list);
    }
    const dupByRound = new Map<number, Set<string>>();
    for (const [r, ms] of Array.from(byRound.entries())) {
      const count = new Map<string, number>();
      for (const m of ms) {
        for (const id of idsInMatch(m)) {
          count.set(id, (count.get(id) ?? 0) + 1);
        }
      }
      const dupIds = new Set<string>(
        Array.from(count.entries())
          .filter(([, c]) => c > 1)
          .map(([id]) => id)
      );
      if (dupIds.size > 0) dupByRound.set(r, dupIds);
    }
    return dupByRound;
  }, [visibleMatches, roundKeyFor]);

  const conflictMatchIds = useMemo(() => {
    const byRound = new Map<number, MatchRow[]>();
    for (const m of visibleMatches) {
      const rk = roundKeyFor(m);
      const list = byRound.get(rk) ?? [];
      list.push(m);
      byRound.set(rk, list);
    }
    const conflict = new Set<string>();
    for (const [r, ms] of Array.from(byRound.entries())) {
      const count = new Map<string, number>();
      for (const m of ms) {
        for (const id of idsInMatch(m)) {
          count.set(id, (count.get(id) ?? 0) + 1);
        }
      }
      const dupIds = new Set(
        Array.from(count.entries())
          .filter(([, c]) => c > 1)
          .map(([id]) => id)
      );
      if (dupIds.size === 0) continue;
      for (const m of ms) {
        if (idsInMatch(m).some((id) => dupIds.has(id))) conflict.add(m.id);
      }
      if (conflictRound === r) {
        for (const m of ms) conflict.add(m.id);
      }
    }
    return conflict;
  }, [visibleMatches, conflictRound, roundKeyFor]);

  const attendingPlayersMemo = useMemo(
    () => players.filter((p) => !!attendance[p.id]),
    [players, attendance]
  );

  const attendingOptionsMemo = useMemo(
    () =>
      attendingPlayersMemo
        .slice()
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [attendingPlayersMemo]
  );

  // If the selected slot has no player (e.g. P3), default to first attending
  // so the save button is responsive on first open.
  useEffect(() => {
    if (!editing) return;
    if (editing.playerId) return;
    if (attendingOptionsMemo.length === 0) return;
    setEditing((prev) =>
      prev ? { ...prev, playerId: attendingOptionsMemo[0].id } : prev
    );
  }, [editing, attendingOptionsMemo]);

  const reload = useCallback(async () => {
    if (!slug || !nightId || !isSupabaseConfigured) return;
    setLoading(true);
    setErr(null);
    try {
      const s = await fetchSeasonBySlug(slug);
      if (!s) {
        setSeason(null);
        setNight(null);
        setErr('Season not found.');
        return;
      }
      setSeason(s);
      const n = await fetchGameNightById(nightId);
      if (!n || n.season_id !== s.id) {
        setNight(null);
        setErr('This game night does not belong to this season.');
        return;
      }
      setNight(n);
      const [pl, att, mt] = await Promise.all([
        fetchPlayers(s.id),
        fetchAttendance(nightId),
        fetchMatchesForNight(nightId),
      ]);
      setPlayers(pl);
      const attMap: Record<string, boolean> = {};
      for (const a of att) attMap[a.player_id] = a.attending;
      for (const p of pl) {
        if (attMap[p.id] === undefined) attMap[p.id] = true;
      }
      setAttendance(attMap);
      setMatches(mt);
      setConflictRound(null);
      const draft: Record<string, { a: string; b: string }> = {};
      for (const m of mt) {
        draft[m.id] = {
          a: m.score_a != null ? String(m.score_a) : '',
          b: m.score_b != null ? String(m.score_b) : '',
        };
      }
      setScoreDraft(draft);
    } finally {
      setLoading(false);
    }
  }, [slug, nightId]);

  useEffect(() => {
    reload().catch((e) => setErr(e instanceof Error ? e.message : 'Load failed'));
  }, [reload]);

  async function toggleAttend(playerId: string, attending: boolean) {
    if (!nightId) return;
    setBusy(true);
    setErr(null);
    try {
      await rpcSetAttendance(nightId, playerId, attending);
      setAttendance((prev) => ({ ...prev, [playerId]: attending }));
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function generateSchedule() {
    if (!nightId || !season || !night) return;
    const rounds = season.games_per_night;
    const attendingIds = players
      .filter((p) => attendance[p.id])
      .map((p) => p.id);
    if (attendingIds.length < 4) {
      setErr('Need at least four attending players to schedule.');
      return;
    }
    if (
      matches.some(
        (m) =>
          m.stage === 'playoffs_pool' ||
          m.stage === 'playoffs_gold' ||
          m.stage === 'playoffs_silver'
      )
    ) {
      setErr(
        'This night has playoff matches. Regular schedule generation deletes every match on this night, including playoffs. Use a league-only night for “Generate schedule,” or rebuild playoffs from Season admin → Playoffs.'
      );
      return;
    }
    // Auto-size courts from attendance (no nets setting in UI).
    // 4 players per court (2v2). Round down so we never oversubscribe courts.
    const nets = Math.max(1, Math.min(12, Math.floor(attendingIds.length / 4)));
    if (
      matches.some(
        (m) => m.score_a != null || m.score_b != null
      ) &&
      !window.confirm(
        'Regenerating clears all scores for this night. Continue?'
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const prior = await fetchPriorMatchLikeForSeason(
        season.id,
        nightId
      );
      const sched = buildSchedule(attendingIds, nets, rounds, prior);
      if (sched.length === 0) {
        setErr('Could not build a schedule (check attendance).');
        return;
      }
      await rpcSaveSchedule(nightId, sched);
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function saveAllScores() {
    const toSave = matches
      .map((m) => ({ match: m, draft: scoreDraft[m.id] }))
      .filter(
        ({ draft }) => draft && draft.a.trim() !== '' && draft.b.trim() !== ''
      );
    if (toSave.length === 0) {
      setErr('Enter at least one score before saving.');
      return;
    }
    for (const { draft } of toSave) {
      const sa = Number(draft.a);
      const sb = Number(draft.b);
      if (Number.isNaN(sa) || Number.isNaN(sb) || sa < 0 || sb < 0) {
        setErr('Scores must be non-negative numbers.');
        return;
      }
    }

    setBusy(true);
    setErr(null);
    try {
      await Promise.all(
        toSave.map(({ match, draft }) =>
          rpcSetMatchScore(match.id, Number(draft.a), Number(draft.b))
        )
      );
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  async function saveMatchPlayerEdit(next: MatchRow) {
    const rk = roundKeyFor(next);
    const inRound = visibleMatches.filter((m) => roundKeyFor(m) === rk);
    const hypothetical = inRound.map((m) => (m.id === next.id ? next : m));
    const count = new Map<string, number>();
    for (const m of hypothetical) {
      for (const id of idsInMatch(m)) {
        count.set(id, (count.get(id) ?? 0) + 1);
      }
    }
    const dupNames = Array.from(count.entries())
      .filter(([, c]) => c > 1)
      .map(([id]) => nameById.get(id) ?? id);
    const hasConflict = dupNames.length > 0;
    if (hasConflict) {
      // Allow saving anyway so the admin can make a swap across two matches.
      // We keep the round highlighted and show a warning so they can resolve next.
      setConflictRound(rk);
      setErr(
        `Conflict in round ${rk + 1}: ${dupNames.join(
          ', '
        )} appears in multiple matches. Save anyway, then edit the highlighted matchup(s) to resolve.`
      );
      if (
        !window.confirm(
          `This change will temporarily create a conflict in round ${
            rk + 1
          }.\n\nSave anyway?`
        )
      ) {
        return;
      }
    } else {
      // Clear any prior conflict highlight when we successfully propose a non-conflicting change.
      setConflictRound(null);
    }

    const hadScores = next.score_a != null || next.score_b != null;
    if (
      hadScores &&
      !window.confirm(
        'Editing a matchup clears the saved score for this match. Continue?'
      )
    ) {
      return;
    }

    setBusy(true);
    // Keep any warning text visible while saving if conflict exists.
    if (!hasConflict) setErr(null);
    try {
      await rpcAdminUpdateMatchPlayers({
        matchId: next.id,
        team_a_p1: next.team_a_p1,
        team_a_p2: next.team_a_p2,
        team_a_p3: next.team_a_p3,
        team_b_p1: next.team_b_p1,
        team_b_p2: next.team_b_p2,
        team_b_p3: next.team_b_p3,
      });
      setEditing(null);
      await reload();
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  if (!slug || !nightId) {
    return (
      <Layout title="Game night">
        <p>Invalid link.</p>
      </Layout>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <Layout title="Game night">
        <ConfigBanner />
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout title="Game night">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  if (!season || !night) {
    return (
      <Layout title="Game night">
        {err ? <p className="error">{err}</p> : <p>Not found.</p>}
      </Layout>
    );
  }

  const byRound = new Map<number, MatchRow[]>();
  for (const m of visibleMatches) {
    const rk = roundKeyFor(m);
    const list = byRound.get(rk) ?? [];
    list.push(m);
    byRound.set(rk, list);
  }
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  const attendingCount = players.filter((p) => !!attendance[p.id]).length;
  const attendingPlayers = attendingPlayersMemo;
  const attendingOptions = attendingOptionsMemo;

  return (
    <Layout
      title={`${season.name} · ${night.night_date}`}
      subtitle={`${season.games_per_night} rounds (target games per player)`}
      actions={
        <Link className="btn small secondary" to={`/league/${slug}/admin`}>
          ← Back
        </Link>
      }
    >
      {err ? <p className="error banner-inline">{err}</p> : null}

      <section className="card">
        <h2>{`Who’s playing tonight (${attendingCount})`}</h2>
        <p className="hint">
          Everyone on the roster appears here. Turn off anyone who’s out; they
          won’t be scheduled.
        </p>
        <ul className="list check-list">
          {players.map((p) => (
            <li key={p.id} className="list-row">
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!attendance[p.id]}
                  disabled={busy}
                  onChange={(e) => toggleAttend(p.id, e.target.checked)}
                />
                {p.display_name}
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Schedule</h2>
        <p className="hint">
          Builds {season.games_per_night} rounds across all courts. Pairings
          favor fresh partners and opponents using the full season history.
          Regenerating wipes scores for this night.
        </p>
        {hasPlayoffMatches ? (
          <div className="tabs" style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              className={scheduleView === 'regular' ? 'tab active' : 'tab'}
              onClick={() => setScheduleView('regular')}
            >
              Regular
            </button>
            <button
              type="button"
              className={scheduleView === 'playoffs_pool' ? 'tab active' : 'tab'}
              onClick={() => setScheduleView('playoffs_pool')}
            >
              Playoffs · Pools
            </button>
            {matches.some((m) => m.stage === 'playoffs_gold') ? (
              <button
                type="button"
                className={
                  scheduleView === 'playoffs_gold' ? 'tab active' : 'tab'
                }
                onClick={() => setScheduleView('playoffs_gold')}
              >
                Playoffs · Gold
              </button>
            ) : null}
            {matches.some((m) => m.stage === 'playoffs_silver') ? (
              <button
                type="button"
                className={
                  scheduleView === 'playoffs_silver' ? 'tab active' : 'tab'
                }
                onClick={() => setScheduleView('playoffs_silver')}
              >
                Playoffs · Silver
              </button>
            ) : null}
          </div>
        ) : null}

        {scheduleView === 'regular' ? (
          <div style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => generateSchedule()}
            >
              {matches.filter((m) => !m.stage || m.stage === 'regular').length
                ? 'Regenerate schedule'
                : 'Generate schedule'}
            </button>
            {matches.filter((m) => !m.stage || m.stage === 'regular').length >
            0 ? (
              <>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={saveAllScores}
                  style={{ marginLeft: '0.6rem' }}
                >
                  Save all entered scores
                </button>
                <Link
                  className="btn secondary"
                  style={{ marginLeft: '0.6rem' }}
                  to={`/league/${slug}/admin/night/${nightId}/sheet`}
                >
                  Share / screenshot
                </Link>
              </>
            ) : null}
          </div>
        ) : (
          <div style={{ marginTop: '0.75rem' }}>
            <p className="hint" style={{ marginTop: 0 }}>
              Playoffs are generated from{' '}
              <Link to={`/league/${slug}/admin`}>Season admin → Playoffs</Link>.
            </p>
            {visibleMatches.length > 0 ? (
              <>
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={saveAllScores}
                >
                  Save all entered scores
                </button>
                <Link
                  className="btn secondary"
                  style={{ marginLeft: '0.6rem' }}
                  to={`/league/${slug}/admin/night/${nightId}/sheet`}
                >
                  Share / screenshot
                </Link>
              </>
            ) : null}
          </div>
        )}

        {rounds.length === 0 ? (
          <p className="muted">
            {scheduleView === 'playoffs_pool'
              ? 'No pool matches yet.'
              : scheduleView === 'playoffs_gold'
                ? 'No gold bracket matches yet.'
                : scheduleView === 'playoffs_silver'
                  ? 'No silver bracket matches yet.'
                  : 'No matches yet.'}
          </p>
        ) : (
          rounds.map((r) => (
            <div key={r} className="round-block">
              <h3>
                {scheduleView === 'playoffs_pool'
                  ? `Pool Round ${r + 1}`
                  : scheduleView === 'playoffs_gold'
                    ? `Gold Round ${r + 1}`
                    : scheduleView === 'playoffs_silver'
                      ? `Silver Round ${r + 1}`
                      : `Round ${r + 1}`}
              </h3>
              {(() => {
                const roundMatches = byRound.get(r) ?? [];
                if (scheduleView !== 'regular') return null;
                const inRound = new Set<string>();
                for (const m of roundMatches) {
                  inRound.add(m.team_a_p1);
                  inRound.add(m.team_a_p2);
                  if (m.team_a_p3) inRound.add(m.team_a_p3);
                  inRound.add(m.team_b_p1);
                  inRound.add(m.team_b_p2);
                  if (m.team_b_p3) inRound.add(m.team_b_p3);
                }
                const sitting = attendingPlayers
                  .filter((p) => !inRound.has(p.id))
                  .map((p) => p.display_name);
                return sitting.length > 0 ? (
                  <p className="hint">{`Sitting: ${sitting.join(', ')}`}</p>
                ) : null;
              })()}
              <div className="match-grid">
                {(byRound.get(r) ?? [])
                  .sort((a, b) => a.court_index - b.court_index)
                  .map((m) => {
                    const draft = scoreDraft[m.id] ?? { a: '', b: '' };
                    return (
                      <div
                        key={m.id}
                        className={`match-card${
                          conflictMatchIds.has(m.id) ? ' match-card--conflict' : ''
                        }`}
                      >
                        <div className="match-card-head">
                          <div className="court-label">
                            {scheduleView === 'playoffs_pool' && m.pool_index != null
                              ? `Pool ${String.fromCharCode(65 + m.pool_index)} · Court ${m.court_index + 1}`
                              : `Court ${m.court_index + 1}`}
                          </div>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Edit matchup"
                            aria-label="Edit matchup"
                            disabled={busy}
                            onClick={() =>
                              (() => {
                                const dupIds = conflictDupByRound.get(roundKeyFor(m));
                                const dupPlayer = dupIds
                                  ? idsInMatch(m).find((id) => dupIds.has(id))
                                  : undefined;
                                const slot = dupPlayer ? slotForPlayer(m, dupPlayer) : null;
                                setEditing({
                                  matchId: m.id,
                                  slot: (slot ?? 'team_a_p1') as any,
                                  playerId: dupPlayer ?? m.team_a_p1,
                                });
                              })()
                            }
                          >
                            ✎
                          </button>
                        </div>
                        <div className="teams">
                          <div>
                            <strong>
                              {[m.team_a_p1, m.team_a_p2, m.team_a_p3]
                                .filter(Boolean)
                                .map((id) => nameById.get(id as string) ?? (id as string))
                                .join(' / ')}
                            </strong>
                          </div>
                          <div className="vs">vs</div>
                          <div>
                            <strong>
                              {[m.team_b_p1, m.team_b_p2, m.team_b_p3]
                                .filter(Boolean)
                                .map((id) => nameById.get(id as string) ?? (id as string))
                                .join(' / ')}
                            </strong>
                          </div>
                        </div>
                        <div className="score-row">
                          <input
                            className="score-input"
                            inputMode="numeric"
                            value={draft.a}
                            onChange={(e) =>
                              setScoreDraft((prev) => ({
                                ...prev,
                                [m.id]: { ...draft, a: e.target.value },
                              }))
                            }
                            placeholder="A"
                          />
                          <span className="dash">—</span>
                          <input
                            className="score-input"
                            inputMode="numeric"
                            value={draft.b}
                            onChange={(e) =>
                              setScoreDraft((prev) => ({
                                ...prev,
                                [m.id]: { ...draft, b: e.target.value },
                              }))
                            }
                            placeholder="B"
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))
        )}
      </section>

      {editing
        ? (() => {
            const match = matches.find((m) => m.id === editing.matchId);
            if (!match) return null;
            const curId = (match as unknown as Record<string, string | null>)[
              editing.slot
            ];
            const slotLabel: Record<string, string> = {
              team_a_p1: 'Team A · P1',
              team_a_p2: 'Team A · P2',
              team_a_p3: 'Team A · P3',
              team_b_p1: 'Team B · P1',
              team_b_p2: 'Team B · P2',
              team_b_p3: 'Team B · P3',
            };
            const apply = async () => {
              const next = {
                ...match,
                [editing.slot]: editing.playerId,
              } as MatchRow;
              await saveMatchPlayerEdit(next);
            };
            return (
              <div className="modal-backdrop" role="dialog" aria-modal="true">
                <div className="modal card">
                  <div className="modal-head">
                    <h2>Edit matchup</h2>
                    <button
                      type="button"
                      className="btn text"
                      onClick={() => setEditing(null)}
                      disabled={busy}
                    >
                      Close
                    </button>
                  </div>
                  <p className="hint">
                    Swap a player into a slot. If this schedules someone twice
                    in the same round, we’ll warn you and highlight the
                    conflicts.
                  </p>
                  {err ? <p className="error">{err}</p> : null}
                  <div className="field-row">
                    <label className="field">
                      <span>Slot</span>
                      <select
                        value={editing.slot}
                        onChange={(e) => {
                          const slot = e.target.value as typeof editing.slot;
                          const current =
                            (match as unknown as Record<string, string | null>)[slot] ??
                            '';
                          setEditing((prev) =>
                            prev ? { ...prev, slot, playerId: current } : prev
                          );
                        }}
                      >
                        <option value="team_a_p1">{slotLabel.team_a_p1}</option>
                        <option value="team_a_p2">{slotLabel.team_a_p2}</option>
                        <option value="team_a_p3">{slotLabel.team_a_p3}</option>
                        <option value="team_b_p1">{slotLabel.team_b_p1}</option>
                        <option value="team_b_p2">{slotLabel.team_b_p2}</option>
                        <option value="team_b_p3">{slotLabel.team_b_p3}</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Player</span>
                      <select
                        value={editing.playerId}
                        onChange={(e) =>
                          setEditing((prev) =>
                            prev ? { ...prev, playerId: e.target.value } : prev
                          )
                        }
                      >
                        {attendingOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.display_name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <p className="muted small">
                    Current:{' '}
                    <strong>{curId ? nameById.get(curId) ?? curId : '—'}</strong>
                  </p>
                  <div className="actions-row">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy || !editing.playerId}
                      onClick={() => void apply()}
                    >
                      {busy ? 'Saving…' : 'Save matchup change'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()
        : null}
    </Layout>
  );
}
