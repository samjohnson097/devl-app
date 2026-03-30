import React, { useMemo, useState } from 'react';
import type { MatchRow } from '../api/leagueApi';
import { formatOrdinalLongDate, weekdayLong } from '../lib/dates';
import { computeStandings } from '../lib/standings';

export type NightRecap = { id: string; date: string; matches: MatchRow[] };

function teamLabel(
  ids: (string | null)[],
  nameById: Map<string, string>
): string {
  return ids
    .filter(Boolean)
    .map((id) => nameById.get(id as string) ?? (id as string))
    .join(' · ');
}

function groupByRound(matches: MatchRow[]): {
  rounds: number[];
  byRound: Map<number, MatchRow[]>;
} {
  const byRound = new Map<number, MatchRow[]>();
  for (const m of matches) {
    const r = m.round_index;
    const list = byRound.get(r) ?? [];
    list.push(m);
    byRound.set(r, list);
  }
  Array.from(byRound.values()).forEach((list) => {
    list.sort((a: MatchRow, b: MatchRow) => a.court_index - b.court_index);
  });
  const rounds = Array.from(byRound.keys()).sort((a, b) => a - b);
  return { rounds, byRound };
}

function NightRoundCarousel({
  night,
  nameById,
}: {
  night: NightRecap;
  nameById: Map<string, string>;
}) {
  const { rounds, byRound } = useMemo(
    () => groupByRound(night.matches),
    [night.matches]
  );
  const [slide, setSlide] = useState(0);

  const weekStandings = useMemo(() => {
    const players = Array.from(nameById.entries()).map(([id, display_name]) => ({
      id,
      display_name,
    }));
    const rows = computeStandings(players, night.matches);
    return rows.filter((r) => r.wins + r.losses > 0);
  }, [nameById, night.matches]);

  const slideCount = rounds.length + 1; // +1 for week standings
  const maxIdx = Math.max(0, slideCount - 1);
  const currentIdx = Math.min(Math.max(0, slide), maxIdx);

  const isStandingsSlide = currentIdx === 0;
  const roundIdx = Math.max(0, currentIdx - 1);
  const roundNum = rounds[roundIdx];
  const roundMatches = roundNum !== undefined ? byRound.get(roundNum) ?? [] : [];

  const go = (delta: number) => {
    if (rounds.length === 0) return;
    setSlide((s) => {
      const i = Math.min(Math.max(0, s), maxIdx);
      const next = i + delta;
      if (next < 0) return maxIdx;
      if (next > maxIdx) return 0;
      return next;
    });
  };

  return (
    <>
      {rounds.length === 0 ? (
        <p className="muted recap-night-empty">No matchups for this night yet.</p>
      ) : (
        <div className="recap-carousel">
          <div
            className={`recap-carousel-toolbar${slideCount <= 1 ? ' recap-carousel-toolbar--solo' : ''}`}
          >
            {slideCount > 1 ? (
              <>
                <button
                  type="button"
                  className="btn recap-carousel-btn"
                  onClick={() => go(-1)}
                  aria-label="Previous round"
                >
                  ‹
                </button>
                <div className="recap-carousel-label" aria-live="polite">
                  <span className="recap-carousel-round">
                    {isStandingsSlide ? (
                      <>
                        Week standings
                        <span className="recap-carousel-of">
                          {' '}
                          / {slideCount}
                        </span>
                      </>
                    ) : (
                      <>
                        Round {roundIdx + 1}
                        <span className="recap-carousel-of">
                          {' '}
                          / {rounds.length}
                        </span>
                      </>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn recap-carousel-btn"
                  onClick={() => go(1)}
                  aria-label="Next round"
                >
                  ›
                </button>
              </>
            ) : (
              <div className="recap-carousel-label" aria-live="polite">
                <span className="recap-carousel-round">
                  Week standings
                  <span className="recap-carousel-of"> / 1</span>
                </span>
              </div>
            )}
          </div>

          {slideCount > 1 ? (
            <div className="recap-carousel-dots" role="tablist" aria-label="Rounds">
              {Array.from({ length: slideCount }).map((_, i) => (
                <button
                  key={i === 0 ? 'standings' : rounds[i - 1] ?? i}
                  type="button"
                  role="tab"
                  aria-selected={i === currentIdx}
                  className={`recap-dot${i === currentIdx ? ' recap-dot--active' : ''}`}
                  onClick={() => setSlide(i)}
                  aria-label={i === 0 ? 'Week standings' : `Round ${i}`}
                />
              ))}
            </div>
          ) : null}

          <div className="recap-round-pane">
            {isStandingsSlide ? (
              weekStandings.length === 0 ? (
                <p className="muted recap-night-empty">
                  No saved scores yet for this week.
                </p>
              ) : (
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
                      {weekStandings.map((row) => (
                        <tr key={row.playerId}>
                          <td>{row.name}</td>
                          <td>{row.wins}</td>
                          <td>{row.losses}</td>
                          <td>
                            {row.pointDiff > 0 ? `+${row.pointDiff}` : row.pointDiff}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <ul className="recap-match-grid">
                {roundMatches.map((m) => {
                  const teamA = teamLabel(
                    [m.team_a_p1, m.team_a_p2, m.team_a_p3],
                    nameById
                  );
                  const teamB = teamLabel(
                    [m.team_b_p1, m.team_b_p2, m.team_b_p3],
                    nameById
                  );
                  const scored = m.score_a != null && m.score_b != null;
                  return (
                    <li key={m.id} className="recap-match-card">
                      <div className="recap-court-badge">
                        Court {m.court_index + 1}
                      </div>
                      <div className="recap-match-teams">
                        <div className="recap-team recap-team--a">
                          <span className="recap-team-label">{teamA}</span>
                        </div>
                        <div className="recap-score-slot">
                          {scored ? (
                            <div className="recap-score-pill" aria-label="Score">
                              <span className="recap-score-num">{m.score_a}</span>
                              <span className="recap-score-sep">–</span>
                              <span className="recap-score-num">{m.score_b}</span>
                            </div>
                          ) : (
                            <span className="recap-score-pending">vs</span>
                          )}
                        </div>
                        <div className="recap-team recap-team--b">
                          <span className="recap-team-label">{teamB}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function MatchRecapSection({
  nights,
  nameById,
  recentNightsChecked,
}: {
  nights: NightRecap[];
  nameById: Map<string, string>;
  /** How many latest nights we looked at (for empty copy). */
  recentNightsChecked: number;
}) {
  return (
    <section className="card matchups-recap-card">
      <h2>Previous weeks matchups</h2>
      <p className="muted matchups-recap-lead">
        Tap a date to expand. Browse rounds with the arrows; scores show when
        they have been saved.
      </p>
      {nights.length === 0 ? (
        <p className="muted">
          {recentNightsChecked === 0
            ? 'No game nights yet.'
            : 'No matchups on the latest nights yet.'}
        </p>
      ) : (
        <div className="recap-nights-stack">
          {nights.map((night) => (
            <details key={night.id} className="recap-night">
              <summary className="recap-night-summary">
                <span className="recap-night-summary-text">
                  <span className="recap-night-title">
                    {formatOrdinalLongDate(night.date)}
                  </span>
                  <span className="recap-night-sub muted">
                    {weekdayLong(night.date)}
                  </span>
                </span>
                <span className="recap-night-chevron" aria-hidden="true" />
              </summary>
              <div className="recap-night-body">
                <NightRoundCarousel night={night} nameById={nameById} />
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
