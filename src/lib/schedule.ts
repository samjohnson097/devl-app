export interface MatchLike {
  team_a_p1: string;
  team_a_p2: string;
  team_a_p3?: string | null;
  team_b_p1: string;
  team_b_p2: string;
  team_b_p3?: string | null;
}

export interface ScheduledMatch {
  round_index: number;
  court_index: number;
  team_a_p1: string;
  team_a_p2: string;
  team_a_p3?: string | null;
  team_b_p1: string;
  team_b_p2: string;
  team_b_p3?: string | null;
}

/**
 * Minimum courts so every player can play each round (no forced sit-outs except
 * one when n % 4 is 1 or 3). Uses one 3v3 match when n % 4 is 2 or 3.
 */
export function minimumNetsForAttendance(playerCount: number): number {
  const n = playerCount;
  if (n < 4) return 1;
  const rem = n % 4;
  if (rem === 0) return Math.floor(n / 4);
  if (rem === 1) return Math.floor((n - 1) / 4);
  if (rem === 2) return Math.floor((n - 6) / 4) + 1;
  return Math.floor((n - 7) / 4) + 1;
}

interface History {
  partner: Map<string, number>;
  opponent: Map<string, number>;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildHistoryFromMatches(matches: MatchLike[]): History {
  const partner = new Map<string, number>();
  const opponent = new Map<string, number>();

  const addP = (p1: string, p2: string) => {
    const k = pairKey(p1, p2);
    partner.set(k, (partner.get(k) ?? 0) + 1);
  };
  const addO = (x: string, y: string) => {
    const k = pairKey(x, y);
    opponent.set(k, (opponent.get(k) ?? 0) + 1);
  };

  for (const m of matches) {
    const teamA = [m.team_a_p1, m.team_a_p2, m.team_a_p3 ?? null].filter(
      Boolean
    ) as string[];
    const teamB = [m.team_b_p1, m.team_b_p2, m.team_b_p3 ?? null].filter(
      Boolean
    ) as string[];
    for (let i = 0; i < teamA.length; i++) {
      for (let j = i + 1; j < teamA.length; j++) {
        addP(teamA[i], teamA[j]);
      }
    }
    for (let i = 0; i < teamB.length; i++) {
      for (let j = i + 1; j < teamB.length; j++) {
        addP(teamB[i], teamB[j]);
      }
    }
    for (const a of teamA) {
      for (const b of teamB) {
        addO(a, b);
      }
    }
  }
  return { partner, opponent };
}

function partnerCost(p1: string, p2: string, h: History, t: History): number {
  const k = pairKey(p1, p2);
  return (h.partner.get(k) ?? 0) + (t.partner.get(k) ?? 0);
}

function opponentCross(
  teamA: [string, string],
  teamB: [string, string],
  h: History,
  t: History
): number {
  let c = 0;
  for (const a of teamA) {
    for (const b of teamB) {
      const k = pairKey(a, b);
      c += (h.opponent.get(k) ?? 0) + (t.opponent.get(k) ?? 0);
    }
  }
  return c;
}

function splitCost(
  teamA: [string, string],
  teamB: [string, string],
  history: History,
  tonight: History
): number {
  let cost =
    partnerCost(teamA[0], teamA[1], history, tonight) * 4 +
    partnerCost(teamB[0], teamB[1], history, tonight) * 4;
  cost += opponentCross(teamA, teamB, history, tonight);
  return cost;
}

function splitCostSix(
  teamA: [string, string, string],
  teamB: [string, string, string],
  history: History,
  tonight: History
): number {
  const pairsA: Array<[string, string]> = [
    [teamA[0], teamA[1]],
    [teamA[0], teamA[2]],
    [teamA[1], teamA[2]],
  ];
  const pairsB: Array<[string, string]> = [
    [teamB[0], teamB[1]],
    [teamB[0], teamB[2]],
    [teamB[1], teamB[2]],
  ];
  let cost = 0;
  for (const [p1, p2] of pairsA) cost += partnerCost(p1, p2, history, tonight) * 4;
  for (const [p1, p2] of pairsB) cost += partnerCost(p1, p2, history, tonight) * 4;
  for (const a of teamA) {
    for (const b of teamB) {
      const k = pairKey(a, b);
      cost += (history.opponent.get(k) ?? 0) + (tonight.opponent.get(k) ?? 0);
    }
  }
  return cost;
}

function bestSplitForQuartet(
  w: string,
  x: string,
  y: string,
  z: string,
  history: History,
  tonight: History
): { cost: number; teamA: [string, string]; teamB: [string, string] } {
  const options: Array<{ cost: number; teamA: [string, string]; teamB: [string, string] }> = [
    {
      cost: splitCost([w, x], [y, z], history, tonight),
      teamA: [w, x],
      teamB: [y, z],
    },
    {
      cost: splitCost([w, y], [x, z], history, tonight),
      teamA: [w, y],
      teamB: [x, z],
    },
    {
      cost: splitCost([w, z], [x, y], history, tonight),
      teamA: [w, z],
      teamB: [x, y],
    },
  ];
  options.sort((a, b) => a.cost - b.cost);
  return options[0];
}

function combinationsFour(pool: string[]): string[][] {
  const out: string[][] = [];
  const n = pool.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          out.push([pool[a], pool[b], pool[c], pool[d]]);
        }
      }
    }
  }
  return out;
}

function combinationsSix(pool: string[]): string[][] {
  const out: string[][] = [];
  const n = pool.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          for (let e = d + 1; e < n; e++) {
            for (let f = e + 1; f < n; f++) {
              out.push([pool[a], pool[b], pool[c], pool[d], pool[e], pool[f]]);
            }
          }
        }
      }
    }
  }
  return out;
}

function sampleCombos(combos: string[][], limit: number): string[][] {
  if (combos.length <= limit) return combos;
  shuffleInPlace(combos);
  return combos.slice(0, limit);
}

function pickBestQuartet(
  available: string[],
  history: History,
  tonight: History,
  gamesTonight: Map<string, number>
): string[] | null {
  if (available.length < 4) return null;

  const sorted = [...available].sort(
    (a, b) => (gamesTonight.get(a) ?? 0) - (gamesTonight.get(b) ?? 0)
  );
  const head = Math.min(sorted.length, 14);
  const pool = sorted.slice(0, head);
  let combos = combinationsFour(pool);
  combos = sampleCombos(combos, 450);

  let bestTotal = Infinity;
  let bestQuartet: string[] | null = null;

  for (const q of combos) {
    const [w, x, y, z] = q;
    const split = bestSplitForQuartet(w, x, y, z, history, tonight);
    const fairness =
      (gamesTonight.get(w) ?? 0) +
      (gamesTonight.get(x) ?? 0) +
      (gamesTonight.get(y) ?? 0) +
      (gamesTonight.get(z) ?? 0);
    const total = split.cost + fairness * 6;
    if (total < bestTotal) {
      bestTotal = total;
      bestQuartet = q;
    }
  }

  return bestQuartet;
}

function bestSplitForSix(
  six: [string, string, string, string, string, string],
  history: History,
  tonight: History
): { cost: number; teamA: [string, string, string]; teamB: [string, string, string] } {
  const [a, b, c, d, e, f] = six;
  const options: Array<{ teamA: [string, string, string]; teamB: [string, string, string] }> = [
    { teamA: [a, b, c], teamB: [d, e, f] },
    { teamA: [a, b, d], teamB: [c, e, f] },
    { teamA: [a, b, e], teamB: [c, d, f] },
    { teamA: [a, b, f], teamB: [c, d, e] },
    { teamA: [a, c, d], teamB: [b, e, f] },
    { teamA: [a, c, e], teamB: [b, d, f] },
    { teamA: [a, c, f], teamB: [b, d, e] },
    { teamA: [a, d, e], teamB: [b, c, f] },
    { teamA: [a, d, f], teamB: [b, c, e] },
    { teamA: [a, e, f], teamB: [b, c, d] },
  ];
  let best = {
    cost: Infinity,
    teamA: options[0].teamA,
    teamB: options[0].teamB,
  };
  for (const opt of options) {
    const cst = splitCostSix(opt.teamA, opt.teamB, history, tonight);
    if (cst < best.cost) {
      best = { cost: cst, teamA: opt.teamA, teamB: opt.teamB };
    }
  }
  return best;
}

function pickBestSix(
  available: string[],
  history: History,
  tonight: History,
  gamesTonight: Map<string, number>
): string[] | null {
  if (available.length < 6) return null;
  const sorted = [...available].sort(
    (a, b) => (gamesTonight.get(a) ?? 0) - (gamesTonight.get(b) ?? 0)
  );
  const head = Math.min(sorted.length, 12);
  const pool = sorted.slice(0, head);
  let combos = combinationsSix(pool);
  combos = sampleCombos(combos, 240);
  let bestTotal = Infinity;
  let best: string[] | null = null;
  for (const c of combos) {
    const split = bestSplitForSix(c as [string, string, string, string, string, string], history, tonight);
    const fairness = c.reduce((sum, id) => sum + (gamesTonight.get(id) ?? 0), 0);
    const total = split.cost + fairness * 6;
    if (total < bestTotal) {
      bestTotal = total;
      best = c;
    }
  }
  return best;
}

function pickSitOutPlayer(
  candidates: string[],
  sitTonight: Map<string, number>,
  gamesTonight: Map<string, number>
): string | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const sitA = sitTonight.get(a) ?? 0;
    const sitB = sitTonight.get(b) ?? 0;
    if (sitA !== sitB) return sitA - sitB;
    const gamesA = gamesTonight.get(a) ?? 0;
    const gamesB = gamesTonight.get(b) ?? 0;
    if (gamesA !== gamesB) return gamesA - gamesB;
    return Math.random() - 0.5;
  });
  return sorted[0] ?? null;
}

/**
 * Builds up to `rounds` rounds of 2v2 across `nets` courts.
 * Uses season history + tonight's pairings to maximize matchup variance.
 * Players who cannot fit on a court in a round sit that round (common when count > 4 * nets).
 */
export function buildSchedule(
  attendingPlayerIds: string[],
  nets: number,
  rounds: number,
  priorMatches: MatchLike[]
): ScheduledMatch[] {
  const attending = Array.from(new Set(attendingPlayerIds)).filter(Boolean);
  if (attending.length < 4 || nets < 1 || rounds < 1) return [];

  const history = buildHistoryFromMatches(priorMatches);
  const tonight: History = { partner: new Map(), opponent: new Map() };
  const gamesTonight = new Map<string, number>();
  const sitTonight = new Map<string, number>();
  for (const id of attending) gamesTonight.set(id, 0);
  for (const id of attending) sitTonight.set(id, 0);

  const result: ScheduledMatch[] = [];

  for (let round = 0; round < rounds; round++) {
    let available = shuffleInPlace([...attending]);
    const n = attending.length;
    const rem = n % 4;
    const neededCourts = minimumNetsForAttendance(n);
    const canApplySpecial = nets >= neededCourts;
    let twoVTwoCourts = nets;
    let threeVThreeCourt = false;
    if (canApplySpecial) {
      if (rem === 2) {
        twoVTwoCourts = (n - 6) / 4;
        threeVThreeCourt = true;
      } else if (rem === 3) {
        twoVTwoCourts = (n - 7) / 4;
        threeVThreeCourt = true;
      } else if (rem === 1) {
        twoVTwoCourts = (n - 1) / 4;
      } else {
        twoVTwoCourts = n / 4;
      }
    }

    // If exactly one player should sit this round, rotate sit-outs so no one repeats
    // unless the night has more rounds than unique candidates.
    const shouldHaveSingleSitter = canApplySpecial && (rem === 1 || rem === 3);
    if (shouldHaveSingleSitter) {
      const sitter = pickSitOutPlayer(available, sitTonight, gamesTonight);
      if (sitter) {
        const idx = available.indexOf(sitter);
        if (idx !== -1) available.splice(idx, 1);
        sitTonight.set(sitter, (sitTonight.get(sitter) ?? 0) + 1);
      }
    }

    for (let court = 0; court < twoVTwoCourts; court++) {
      const quartet = pickBestQuartet(available, history, tonight, gamesTonight);
      if (!quartet) break;

      const [w, x, y, z] = quartet as [string, string, string, string];
      const split = bestSplitForQuartet(w, x, y, z, history, tonight);

      result.push({
        round_index: round,
        court_index: court,
        team_a_p1: split.teamA[0],
        team_a_p2: split.teamA[1],
        team_b_p1: split.teamB[0],
        team_b_p2: split.teamB[1],
      });

      const addP = (p1: string, p2: string) => {
        const k = pairKey(p1, p2);
        tonight.partner.set(k, (tonight.partner.get(k) ?? 0) + 1);
      };
      const addO = (a1: string, a2: string, b1: string, b2: string) => {
        for (const a of [a1, a2] as const) {
          for (const b of [b1, b2] as const) {
            const k = pairKey(a, b);
            tonight.opponent.set(k, (tonight.opponent.get(k) ?? 0) + 1);
          }
        }
      };

      addP(split.teamA[0], split.teamA[1]);
      addP(split.teamB[0], split.teamB[1]);
      addO(split.teamA[0], split.teamA[1], split.teamB[0], split.teamB[1]);

      for (const id of quartet) {
        const idx = available.indexOf(id);
        if (idx !== -1) available.splice(idx, 1);
        gamesTonight.set(id, (gamesTonight.get(id) ?? 0) + 1);
      }
    }

    if (threeVThreeCourt) {
      const six = pickBestSix(available, history, tonight, gamesTonight);
      if (six) {
        const split = bestSplitForSix(
          six as [string, string, string, string, string, string],
          history,
          tonight
        );
        const court = twoVTwoCourts;
        result.push({
          round_index: round,
          court_index: court,
          team_a_p1: split.teamA[0],
          team_a_p2: split.teamA[1],
          team_a_p3: split.teamA[2],
          team_b_p1: split.teamB[0],
          team_b_p2: split.teamB[1],
          team_b_p3: split.teamB[2],
        });
        const addP3 = (t: [string, string, string]) => {
          const pairs: Array<[string, string]> = [
            [t[0], t[1]],
            [t[0], t[2]],
            [t[1], t[2]],
          ];
          for (const [p1, p2] of pairs) {
            const k = pairKey(p1, p2);
            tonight.partner.set(k, (tonight.partner.get(k) ?? 0) + 1);
          }
        };
        addP3(split.teamA);
        addP3(split.teamB);
        for (const a of split.teamA) {
          for (const b of split.teamB) {
            const k = pairKey(a, b);
            tonight.opponent.set(k, (tonight.opponent.get(k) ?? 0) + 1);
          }
        }
        for (const id of six) {
          const idx = available.indexOf(id);
          if (idx !== -1) available.splice(idx, 1);
          gamesTonight.set(id, (gamesTonight.get(id) ?? 0) + 1);
        }
      }
    } else if (!canApplySpecial) {
      for (let court = twoVTwoCourts; court < nets; court++) {
        const quartet = pickBestQuartet(available, history, tonight, gamesTonight);
        if (!quartet) break;
        const [w, x, y, z] = quartet as [string, string, string, string];
        const split = bestSplitForQuartet(w, x, y, z, history, tonight);
        result.push({
          round_index: round,
          court_index: court,
          team_a_p1: split.teamA[0],
          team_a_p2: split.teamA[1],
          team_b_p1: split.teamB[0],
          team_b_p2: split.teamB[1],
        });
        const addP = (p1: string, p2: string) => {
          const k = pairKey(p1, p2);
          tonight.partner.set(k, (tonight.partner.get(k) ?? 0) + 1);
        };
        addP(split.teamA[0], split.teamA[1]);
        addP(split.teamB[0], split.teamB[1]);
        for (const a of [split.teamA[0], split.teamA[1]] as const) {
          for (const b of [split.teamB[0], split.teamB[1]] as const) {
            const k = pairKey(a, b);
            tonight.opponent.set(k, (tonight.opponent.get(k) ?? 0) + 1);
          }
        }
        for (const id of quartet) {
          const idx = available.indexOf(id);
          if (idx !== -1) available.splice(idx, 1);
          gamesTonight.set(id, (gamesTonight.get(id) ?? 0) + 1);
        }
      }
    }

    // For non-special nights, whoever remains unscheduled is considered sitting.
    if (!shouldHaveSingleSitter && available.length > 0) {
      for (const id of available) {
        sitTonight.set(id, (sitTonight.get(id) ?? 0) + 1);
      }
    }
  }

  return result;
}
