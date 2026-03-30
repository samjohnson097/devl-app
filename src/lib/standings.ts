import type { MatchLike } from './schedule';

export interface MatchWithScores extends MatchLike {
  score_a: number | null;
  score_b: number | null;
}

export interface PlayerStanding {
  playerId: string;
  name: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
}

export function computeStandings(
  players: { id: string; display_name: string }[],
  matches: MatchWithScores[]
): PlayerStanding[] {
  const nameById = new Map(players.map((p) => [p.id, p.display_name]));
  const stats = new Map<
    string,
    { w: number; l: number; pf: number; pa: number }
  >();
  for (const p of players) {
    stats.set(p.id, { w: 0, l: 0, pf: 0, pa: 0 });
  }

  for (const m of matches) {
    if (m.score_a == null || m.score_b == null) continue;
    const sa = m.score_a;
    const sb = m.score_b;
    const teamA = [m.team_a_p1, m.team_a_p2, m.team_a_p3 ?? null].filter(
      Boolean
    ) as string[];
    const teamB = [m.team_b_p1, m.team_b_p2, m.team_b_p3 ?? null].filter(
      Boolean
    ) as string[];
    if (sa === sb) continue;
    const aWins = sa > sb;

    for (const id of teamA) {
      const s = stats.get(id);
      if (!s) continue;
      if (aWins) s.w++;
      else s.l++;
      s.pf += sa;
      s.pa += sb;
    }
    for (const id of teamB) {
      const s = stats.get(id);
      if (!s) continue;
      if (!aWins) s.w++;
      else s.l++;
      s.pf += sb;
      s.pa += sa;
    }
  }

  return Array.from(stats.entries())
    .map(([playerId, s]) => ({
      playerId,
      name: nameById.get(playerId) ?? playerId,
      wins: s.w,
      losses: s.l,
      pointsFor: s.pf,
      pointsAgainst: s.pa,
      pointDiff: s.pf - s.pa,
    }))
    .sort(compareStandingRows);
}

function compareStandingRows(a: PlayerStanding, b: PlayerStanding): number {
  return (
    b.wins - a.wins ||
    b.pointDiff - a.pointDiff ||
    a.losses - b.losses ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Best → worst for playoff seeding. Anyone with zero games played (no W/L yet)
 * is ordered after everyone who has at least one decided game, so walk-ons and
 * new roster adds seed at the bottom.
 */
export function rankPlayerIdsForPlayoffSeeding(
  players: { id: string; display_name: string }[],
  matches: MatchWithScores[]
): string[] {
  const rows = computeStandings(players, matches);
  const played = rows.filter((r) => r.wins + r.losses > 0);
  const notPlayed = rows.filter((r) => r.wins + r.losses === 0);
  played.sort(compareStandingRows);
  notPlayed.sort((a, b) => a.name.localeCompare(b.name));
  return [...played, ...notPlayed].map((r) => r.playerId);
}
