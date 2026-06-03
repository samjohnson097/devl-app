import { buildSchedule, type ScheduledMatch } from './schedule';

function threeVThreeCountsTonight(
  matches: ScheduledMatch[],
  playerIds: string[]
): Map<string, number> {
  const counts = new Map(playerIds.map((id) => [id, 0]));
  for (const m of matches) {
    if (!m.team_a_p3 && !m.team_b_p3) continue;
    const ids = [
      m.team_a_p1,
      m.team_a_p2,
      m.team_a_p3,
      m.team_b_p1,
      m.team_b_p2,
      m.team_b_p3,
    ].filter(Boolean) as string[];
    for (const id of ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

describe('buildSchedule 3v3 balancing', () => {
  test('14 players × 5 rounds keeps each player at ≤3 three-v-three games', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `player-${i}`);
    for (let trial = 0; trial < 24; trial++) {
      const schedule = buildSchedule(ids, 3, 5, []);
      const counts = threeVThreeCountsTonight(schedule, ids);
      const values = Array.from(counts.values());
      const max = values.reduce((m, v) => (v > m ? v : m), 0);
      expect(max).toBeLessThanOrEqual(3);
      const total3v3 = values.reduce((a, b) => a + b, 0);
      expect(total3v3).toBe(30);
    }
  });

  test('15 players (one sitter + 3v3) spreads three-v-three across the night', () => {
    const ids = Array.from({ length: 15 }, (_, i) => `player-${i}`);
    for (let trial = 0; trial < 16; trial++) {
      const schedule = buildSchedule(ids, 4, 5, []);
      const counts = threeVThreeCountsTonight(schedule, ids);
      const values = Array.from(counts.values());
      const max = values.reduce((m, v) => (v > m ? v : m), 0);
      expect(max).toBeLessThanOrEqual(3);
    }
  });
});
