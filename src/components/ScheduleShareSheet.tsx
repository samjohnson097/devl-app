import React, { useMemo } from 'react';
import type { MatchRow } from '../api/leagueApi';
import { formatOrdinalLongDate } from '../lib/dates';

function teamStr(
  ids: (string | null)[],
  nameById: Map<string, string>
): string {
  return ids
    .filter(Boolean)
    .map((id) => nameById.get(id as string) ?? (id as string))
    .join('/');
}

export function ScheduleShareSheet(props: {
  seasonName: string;
  nightDateIso: string;
  gamesPerNight: number;
  matches: MatchRow[];
  nameById: Map<string, string>;
  attendingPlayers: Array<{ id: string; display_name: string }>;
}) {
  const {
    seasonName,
    nightDateIso,
    gamesPerNight,
    matches,
    nameById,
    attendingPlayers,
  } = props;

  const byRound = useMemo(() => {
    const m = new Map<number, MatchRow[]>();
    for (const x of matches) {
      const list = m.get(x.round_index) ?? [];
      list.push(x);
      m.set(x.round_index, list);
    }
    Array.from(m.values()).forEach((list) => {
      list.sort((a: MatchRow, b: MatchRow) => a.court_index - b.court_index);
    });
    return m;
  }, [matches]);

  const roundIndices = useMemo(
    () => Array.from(byRound.keys()).sort((a, b) => a - b),
    [byRound]
  );

  return (
    <article className="schedule-share" aria-label="Condensed schedule">
      <header className="schedule-share__header">
        <h1 className="schedule-share__title">{seasonName}</h1>
        <p className="schedule-share__meta">
          {formatOrdinalLongDate(nightDateIso)} · {gamesPerNight} rounds
        </p>
      </header>

      {roundIndices.map((r) => {
        const roundMatches = byRound.get(r) ?? [];
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

        return (
          <section key={r} className="schedule-share__round">
            <h2 className="schedule-share__round-head">R{r + 1}</h2>
            <div className="schedule-share__courts">
              {roundMatches.map((m) => {
                const a = teamStr(
                  [m.team_a_p1, m.team_a_p2, m.team_a_p3],
                  nameById
                );
                const b = teamStr(
                  [m.team_b_p1, m.team_b_p2, m.team_b_p3],
                  nameById
                );
                const scored =
                  m.score_a != null && m.score_b != null
                    ? ` ${m.score_a}–${m.score_b}`
                    : '';
                return (
                  <div key={m.id} className="schedule-share__court">
                    <span className="schedule-share__court-num">{m.court_index + 1}</span>
                    <span className="schedule-share__match">
                      <span className="schedule-share__team">{a}</span>
                      <span className="schedule-share__vs"> v </span>
                      <span className="schedule-share__team">{b}</span>
                      {scored ? (
                        <span className="schedule-share__score">{scored}</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
            {sitting.length > 0 ? (
              <p className="schedule-share__sit">
                Sit: {sitting.join(', ')}
              </p>
            ) : null}
          </section>
        );
      })}
    </article>
  );
}
