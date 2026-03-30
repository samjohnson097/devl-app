export type SeededTeam = {
  seed: number; // 1-based
  player1: string;
  player2: string;
};

export type PooledTeam = SeededTeam & {
  poolIndex: number; // 0..poolCount-1
  poolSeed: number; // 1-based within pool (snake order)
};

export type PoolMatch = {
  poolIndex: number;
  round: number; // 0-based stage round
  homeTeam: PooledTeam;
  awayTeam: PooledTeam;
};

function snakeAssignIndices(count: number, poolCount: number): number[] {
  // Returns poolIndex for seeds 1..count in snake order across pools.
  const out: number[] = [];
  let dir = 1;
  let p = 0;
  for (let i = 0; i < count; i++) {
    out.push(p);
    if (poolCount === 1) continue;
    const next = p + dir;
    if (next < 0 || next >= poolCount) {
      dir *= -1;
      p += dir;
    } else {
      p = next;
    }
  }
  return out;
}

export function seedTeamsByStandings(params: {
  attendingPlayerIds: string[];
  rankedPlayerIds: string[]; // best → worst
}): SeededTeam[] {
  const attendingSet = new Set(params.attendingPlayerIds);
  const rankedAttending = params.rankedPlayerIds.filter((id) =>
    attendingSet.has(id)
  );
  if (rankedAttending.length % 2 !== 0) {
    throw new Error('Playoffs require an even number of attending players.');
  }
  const teams: SeededTeam[] = [];
  for (let i = 0; i < rankedAttending.length; i += 2) {
    teams.push({
      seed: teams.length + 1,
      player1: rankedAttending[i],
      player2: rankedAttending[i + 1],
    });
  }
  return teams;
}

export function assignTeamsToPools(
  seededTeams: SeededTeam[],
  poolCount: number
): PooledTeam[] {
  if (poolCount < 2 || poolCount > 4) {
    throw new Error('Pool count must be between 2 and 4.');
  }
  const idx = snakeAssignIndices(seededTeams.length, poolCount);
  const pooled: PooledTeam[] = seededTeams.map((t, i) => ({
    ...t,
    poolIndex: idx[i],
    poolSeed: 0,
  }));
  const perPool = new Map<number, PooledTeam[]>();
  for (const t of pooled) {
    const list = perPool.get(t.poolIndex) ?? [];
    list.push(t);
    perPool.set(t.poolIndex, list);
  }
  Array.from(perPool.entries()).forEach(([pi, list]) => {
    list.sort((a: PooledTeam, b: PooledTeam) => a.seed - b.seed);
    list.forEach((t: PooledTeam, j: number) => (t.poolSeed = j + 1));
    perPool.set(pi, list);
  });
  return pooled;
}

function rrRounds(teamIds: number[]): Array<Array<[number, number]>> {
  // Circle method. Supports odd counts via bye (-1).
  const ids = teamIds.slice();
  if (ids.length % 2 === 1) ids.push(-1);
  const n = ids.length;
  const rounds: Array<Array<[number, number]>> = [];
  const half = n / 2;

  const arr = ids.slice();
  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== -1 && b !== -1) pairs.push([a, b]);
    }
    rounds.push(pairs);
    // rotate all but first
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop() as number);
    arr.splice(0, n, fixed, ...rest);
  }
  return rounds;
}

export function generatePoolRoundRobin(params: {
  teams: PooledTeam[];
  poolCount: number;
  gamesPerTeam: number; // 3..5 (but capped by pool size - 1)
}): PoolMatch[] {
  const { teams, poolCount } = params;
  const byPool = new Map<number, PooledTeam[]>();
  for (const t of teams) {
    const list = byPool.get(t.poolIndex) ?? [];
    list.push(t);
    byPool.set(t.poolIndex, list);
  }

  const out: PoolMatch[] = [];

  for (let poolIndex = 0; poolIndex < poolCount; poolIndex++) {
    const poolTeams = (byPool.get(poolIndex) ?? []).slice();
    poolTeams.sort((a, b) => a.poolSeed - b.poolSeed);
    // Allow uneven / small pools. With 0–1 teams we just skip; with 2 teams we
    // can only schedule 1 unique matchup.
    if (poolTeams.length < 2) continue;
    const maxOpp = poolTeams.length - 1;
    const gamesPerTeam = Math.max(1, Math.min(params.gamesPerTeam, maxOpp));

    // build candidate rounds
    const ids = poolTeams.map((_, i) => i);
    const rounds = rrRounds(ids);

    // pick rounds in order until each team hits gamesPerTeam
    const played = new Map<number, number>();
    ids.forEach((i) => played.set(i, 0));
    const usedPairs = new Set<string>();
    let stageRound = 0;

    for (const pairs of rounds) {
      // within this stageRound, only keep matches where both teams still need games
      const keep: Array<[number, number]> = [];
      for (const [a, b] of pairs) {
        const pa = played.get(a) ?? 0;
        const pb = played.get(b) ?? 0;
        if (pa >= gamesPerTeam || pb >= gamesPerTeam) continue;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (usedPairs.has(key)) continue;
        keep.push([a, b]);
      }
      if (keep.length === 0) continue;

      for (const [a, b] of keep) {
        usedPairs.add(a < b ? `${a}-${b}` : `${b}-${a}`);
        played.set(a, (played.get(a) ?? 0) + 1);
        played.set(b, (played.get(b) ?? 0) + 1);
        out.push({
          poolIndex,
          round: stageRound,
          homeTeam: poolTeams[a],
          awayTeam: poolTeams[b],
        });
      }
      stageRound++;

      const done = ids.every((i) => (played.get(i) ?? 0) >= gamesPerTeam);
      if (done) break;
    }
  }

  return out;
}

/** Rows accepted by `rpcSaveStageMatches` for `playoffs_pool`. */
export type PlayoffPoolMatchPayloadRow = {
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
  pool_index: number;
  bracket: string | null;
};

/**
 * Build pool-play match rows from attending players and season ranking order.
 */
export function buildPlayoffPoolMatchPayload(
  attendingPlayerIds: string[],
  rankedPlayerIds: string[],
  poolCount: number,
  rrGamesPerTeam: number
): PlayoffPoolMatchPayloadRow[] {
  const seeded = seedTeamsByStandings({
    attendingPlayerIds,
    rankedPlayerIds,
  });
  const pooled = assignTeamsToPools(seeded, poolCount);
  const poolMatches = generatePoolRoundRobin({
    teams: pooled,
    poolCount,
    gamesPerTeam: rrGamesPerTeam,
  });

  const byStageRound = new Map<number, typeof poolMatches>();
  for (const pm of poolMatches) {
    const list = byStageRound.get(pm.round) ?? [];
    list.push(pm);
    byStageRound.set(pm.round, list);
  }

  const rounds = Array.from(byStageRound.keys()).sort((a, b) => a - b);
  const payload: PlayoffPoolMatchPayloadRow[] = [];

  for (const r of rounds) {
    const ms = (byStageRound.get(r) ?? []).slice();
    ms.sort((a, b) => a.poolIndex - b.poolIndex || a.homeTeam.seed - b.homeTeam.seed);
    ms.forEach((m, idx) => {
      payload.push({
        round_index: r,
        court_index: idx,
        team_a_p1: m.homeTeam.player1,
        team_a_p2: m.homeTeam.player2,
        team_a_p3: null,
        team_b_p1: m.awayTeam.player1,
        team_b_p2: m.awayTeam.player2,
        team_b_p3: null,
        score_a: null,
        score_b: null,
        pool_index: m.poolIndex,
        bracket: null,
      });
    });
  }

  return payload;
}

type PoolMatchRowLike = {
  team_a_p1: string;
  team_a_p2: string;
  team_a_p3: string | null;
  team_b_p1: string;
  team_b_p2: string;
  team_b_p3: string | null;
  score_a: number | null;
  score_b: number | null;
  pool_index: number | null;
};

export type DoublesTeam = {
  p1: string;
  p2: string;
};

export type PoolTeamStanding = DoublesTeam & {
  poolIndex: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
};

export type BracketSeed = DoublesTeam & {
  seed: number; // 1-based
  source: string; // e.g. "Pool A #1"
};

export type BracketRound1MatchPayloadRow = {
  round_index: number; // always 0 for round 1
  court_index: number; // 0..n-1
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
};

function teamKey(p1: string, p2: string): string {
  return p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
}

function parseTeam(p1: string, p2: string): DoublesTeam {
  return p1 < p2 ? { p1, p2 } : { p1: p2, p2: p1 };
}

function poolLabel(poolIndex: number): string {
  return `Pool ${String.fromCharCode(65 + poolIndex)}`;
}

export function computePoolStandingsFromMatches(
  poolMatches: PoolMatchRowLike[]
): Map<number, PoolTeamStanding[]> {
  const byPool = new Map<number, Map<string, PoolTeamStanding>>();

  for (const m of poolMatches) {
    const poolIndex = m.pool_index;
    if (poolIndex == null) continue;
    const aKey = teamKey(m.team_a_p1, m.team_a_p2);
    const bKey = teamKey(m.team_b_p1, m.team_b_p2);

    const poolMap = byPool.get(poolIndex) ?? new Map<string, PoolTeamStanding>();
    byPool.set(poolIndex, poolMap);

    if (!poolMap.has(aKey)) {
      const t = parseTeam(m.team_a_p1, m.team_a_p2);
      poolMap.set(aKey, {
        ...t,
        poolIndex,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDiff: 0,
      });
    }
    if (!poolMap.has(bKey)) {
      const t = parseTeam(m.team_b_p1, m.team_b_p2);
      poolMap.set(bKey, {
        ...t,
        poolIndex,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDiff: 0,
      });
    }

    if (m.score_a == null || m.score_b == null) continue;
    if (m.score_a === m.score_b) continue;

    const a = poolMap.get(aKey) as PoolTeamStanding;
    const b = poolMap.get(bKey) as PoolTeamStanding;

    a.pointsFor += m.score_a;
    a.pointsAgainst += m.score_b;
    b.pointsFor += m.score_b;
    b.pointsAgainst += m.score_a;

    if (m.score_a > m.score_b) {
      a.wins += 1;
      b.losses += 1;
    } else {
      b.wins += 1;
      a.losses += 1;
    }
  }

  const out = new Map<number, PoolTeamStanding[]>();
  Array.from(byPool.entries()).forEach(([poolIndex, poolMap]) => {
    const rows = Array.from(poolMap.values()).map((r) => ({
      ...r,
      pointDiff: r.pointsFor - r.pointsAgainst,
    }));
    rows.sort(
      (a, b) =>
        b.wins - a.wins ||
        b.pointDiff - a.pointDiff ||
        a.losses - b.losses ||
        teamKey(a.p1, a.p2).localeCompare(teamKey(b.p1, b.p2))
    );
    out.set(poolIndex, rows);
  });
  return out;
}

/**
 * Selects bracket seeds using TOTAL counts (not per-pool).
 *
 * Selection order is by place across pools:
 * Pool A #1, Pool B #1, ... then Pool A #2, Pool B #2, ...
 *
 * Gold takes the first `totalGold` teams; Silver takes the next `totalSilver`.
 */
export function selectBracketSeedsFromPools(params: {
  standingsByPool: Map<number, PoolTeamStanding[]>;
  totalGold: number;
  totalSilver: number;
}): { gold: BracketSeed[]; silver: BracketSeed[] } {
  const poolIndices = Array.from(params.standingsByPool.keys()).sort(
    (a, b) => a - b
  );

  const ordered: BracketSeed[] = [];
  const maxTeamsInAnyPool = Math.max(
    0,
    ...poolIndices.map((pi) => (params.standingsByPool.get(pi) ?? []).length)
  );
  for (let place = 1; place <= maxTeamsInAnyPool; place++) {
    for (const poolIndex of poolIndices) {
      const rows = params.standingsByPool.get(poolIndex) ?? [];
      const r = rows[place - 1];
      if (!r) continue;
      ordered.push({
        p1: r.p1,
        p2: r.p2,
        seed: 0,
        source: `${poolLabel(poolIndex)} #${place}`,
      });
    }
  }

  const gold = ordered.slice(0, Math.max(0, params.totalGold));
  const silver = ordered.slice(
    Math.max(0, params.totalGold),
    Math.max(0, params.totalGold + params.totalSilver)
  );

  return {
    gold: gold.map((s, idx) => ({ ...s, seed: idx + 1 })),
    silver: silver.map((s, idx) => ({ ...s, seed: idx + 1 })),
  };
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Builds single-elimination Round 1 matches from seeded teams.
 * Byes are represented by missing matches (top seeds simply advance).
 */
export function buildSingleElimRound1Matches(
  seeds: BracketSeed[],
  bracketLabel: string | null
): BracketRound1MatchPayloadRow[] {
  if (seeds.length < 2) return [];
  const bracketSize = nextPow2(seeds.length);

  const payload: BracketRound1MatchPayloadRow[] = [];
  let court = 0;

  // Classic seeding: (1 vs N), (2 vs N-1), ...
  // If a seed's opponent would be a bye slot, we skip creating a match.
  for (let i = 1; i <= bracketSize / 2; i++) {
    const highSeed = i;
    const lowSeed = bracketSize + 1 - i;

    const high = seeds.find((s) => s.seed === highSeed);
    const low = seeds.find((s) => s.seed === lowSeed);

    if (!high) continue; // should not happen
    if (!low) {
      // bye for high seed
      continue;
    }

    // If byes exist, they always occupy the bottom seeds.
    // The 'low' we found is a real team, so create match.
    payload.push({
      round_index: 0,
      court_index: court++,
      team_a_p1: high.p1,
      team_a_p2: high.p2,
      team_a_p3: null,
      team_b_p1: low.p1,
      team_b_p2: low.p2,
      team_b_p3: null,
      score_a: null,
      score_b: null,
      bracket: bracketLabel,
    });
  }

  return payload;
}
