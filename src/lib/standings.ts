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
  /** Decided games played (wins + losses). */
  gamesPlayed: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  /** Wins / (wins + losses), or null if no decided games. */
  winPct: number | null;
}

export type WinPctPenaltyConfig = {
  /** Total possible games in the season for a full-participation player. */
  totalPossibleGames: number;
  /** Minimum fraction of totalPossibleGames before penalty applies. Default 0.5. */
  minFraction?: number;
  /** Subtract this many percentage points when penalized. Default 0.10 (10 points). */
  penaltyPoints?: number;
};

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
    .map(([playerId, s]) => {
      const gp = s.w + s.l;
      return {
        playerId,
        name: nameById.get(playerId) ?? playerId,
        wins: s.w,
        losses: s.l,
        gamesPlayed: gp,
        pointsFor: s.pf,
        pointsAgainst: s.pa,
        pointDiff: s.pf - s.pa,
        winPct: gp === 0 ? null : s.w / gp,
      };
    })
    .sort(compareStandingRows);
}

/** Display e.g. "66.7%" or em dash when no games. */
export function formatWinPctDisplay(winPct: number | null): string {
  if (winPct == null) return '—';
  return `${(winPct * 100).toFixed(1)}%`;
}

function effectiveWinPctFraction(
  row: Pick<PlayerStanding, 'wins' | 'losses' | 'gamesPlayed'>,
  penalty?: WinPctPenaltyConfig
): { num: number; den: number } | null {
  const gp = row.gamesPlayed;
  if (gp <= 0) return null;

  if (!penalty) {
    // Scale by 10 to keep ints, matching the penalized form.
    return { num: 10 * row.wins, den: 10 * gp };
  }

  const total = Math.max(0, penalty.totalPossibleGames);
  const minFraction = penalty.minFraction ?? 0.5;
  const penaltyPoints = penalty.penaltyPoints ?? 0.1;
  const canUseExactTenPoints = Math.abs(penaltyPoints - 0.1) < 1e-9;
  const threshold = Math.ceil(total * minFraction);
  const isPenalized = total > 0 && gp < threshold;

  if (!isPenalized) {
    return { num: 10 * row.wins, den: 10 * gp };
  }

  // 10 percentage points off: win% - 0.10 = (wins/gp) - (1/10) = (10*wins - gp) / (10*gp)
  if (canUseExactTenPoints) {
    return { num: Math.max(0, 10 * row.wins - gp), den: 10 * gp };
  }

  // Fallback: keep close-enough numeric behavior.
  const eff = Math.max(0, row.wins / gp - penaltyPoints);
  return { num: eff, den: 1 } as unknown as { num: number; den: number };
}

export function effectiveWinPct(
  row: Pick<PlayerStanding, 'wins' | 'losses' | 'gamesPlayed'>,
  penalty?: WinPctPenaltyConfig
): number | null {
  const frac = effectiveWinPctFraction(row, penalty);
  if (!frac) return null;
  return frac.num / frac.den;
}

export function sortStandings(
  rows: PlayerStanding[],
  opts?: { penalty?: WinPctPenaltyConfig }
): PlayerStanding[] {
  const penalty = opts?.penalty;
  return rows
    .slice()
    .sort((a, b) => compareStandingRows(a, b, { penalty }));
}

function compareStandingRows(
  a: PlayerStanding,
  b: PlayerStanding,
  opts?: { penalty?: WinPctPenaltyConfig }
): number {
  const agp = a.gamesPlayed ?? a.wins + a.losses;
  const bgp = b.gamesPlayed ?? b.wins + b.losses;
  const aPlayed = agp > 0;
  const bPlayed = bgp > 0;
  if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;

  if (aPlayed && bPlayed) {
    const af = effectiveWinPctFraction(a, opts?.penalty);
    const bf = effectiveWinPctFraction(b, opts?.penalty);
    if (af && bf) {
      const pctCmp = bf.num * af.den - af.num * bf.den;
      if (pctCmp !== 0) return pctCmp > 0 ? 1 : -1;
    }
    // Same win %: more games played ranks higher (larger sample).
    if (bgp !== agp) return bgp > agp ? 1 : -1;
  }

  return (
    b.pointDiff - a.pointDiff ||
    b.wins - a.wins ||
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
  matches: MatchWithScores[],
  opts?: { penalty?: WinPctPenaltyConfig }
): string[] {
  const rows = computeStandings(players, matches);
  return sortStandings(rows, opts).map((r) => r.playerId);
}
