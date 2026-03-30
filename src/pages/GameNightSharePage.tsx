import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  fetchAttendance,
  fetchGameNightById,
  fetchMatchesForNight,
  fetchPlayers,
  fetchSeasonBySlug,
  type PlayerRow,
  type SeasonRow,
} from '../api/leagueApi';
import { ScheduleShareSheet } from '../components/ScheduleShareSheet';
import { isSupabaseConfigured } from '../lib/supabase';
import { ConfigBanner } from '../components/Layout';

export function GameNightSharePage() {
  const { slug, nightId } = useParams<{ slug: string; nightId: string }>();
  const [season, setSeason] = useState<SeasonRow | null>(null);
  const [night, setNight] = useState<Awaited<
    ReturnType<typeof fetchGameNightById>
  > | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [attendance, setAttendance] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!slug || !nightId || !isSupabaseConfigured) return;
    setLoading(true);
    setErr(null);
    try {
      const s = await fetchSeasonBySlug(slug);
      if (!s) {
        setSeason(null);
        setNight(null);
        setMatches([]);
        setErr('Season not found.');
        return;
      }
      setSeason(s);
      const n = await fetchGameNightById(nightId);
      if (!n || n.season_id !== s.id) {
        setNight(null);
        setMatches([]);
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
      setMatches(mt);
      const attMap: Record<string, boolean> = {};
      for (const a of att) attMap[a.player_id] = a.attending;
      for (const p of pl) {
        if (attMap[p.id] === undefined) attMap[p.id] = true;
      }
      setAttendance(attMap);
    } finally {
      setLoading(false);
    }
  }, [slug, nightId]);

  const [matches, setMatches] = useState<
    Awaited<ReturnType<typeof fetchMatchesForNight>>
  >([]);

  useEffect(() => {
    reload().catch((e) => setErr(e instanceof Error ? e.message : 'Load failed'));
  }, [reload]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.display_name);
    return m;
  }, [players]);

  const attendingPlayers = useMemo(
    () => players.filter((p) => !!attendance[p.id]),
    [players, attendance]
  );

  if (!slug || !nightId) {
    return (
      <div className="shell shell--share">
        <p className="main main--share">Invalid link.</p>
      </div>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="shell shell--share">
        <main className="main main--share">
          <ConfigBanner />
        </main>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="shell shell--share">
        <main className="main main--share">
          <p className="muted">Loading…</p>
        </main>
      </div>
    );
  }

  if (!season || !night || err) {
    return (
      <div className="shell shell--share">
        <header className="topbar topbar--share no-print">
          <Link className="btn small secondary" to={`/league/${slug}/admin`}>
            Admin
          </Link>
        </header>
        <main className="main main--share">
          {err ? <p className="error">{err}</p> : <p>Not found.</p>}
        </main>
      </div>
    );
  }

  const backHref = `/league/${slug}/admin/night/${nightId}`;

  return (
    <div className="shell shell--share">
      <header className="topbar topbar--share no-print">
        <Link className="btn small secondary" to={backHref}>
          ← Night editor
        </Link>
      </header>
      <main className="main main--share">
        {matches.length === 0 ? (
          <p className="muted">
            No schedule yet.{' '}
            <Link to={backHref}>Generate a schedule</Link> first.
          </p>
        ) : (
          <ScheduleShareSheet
            seasonName={season.name}
            nightDateIso={night.night_date}
            gamesPerNight={season.games_per_night}
            matches={matches}
            nameById={nameById}
            attendingPlayers={attendingPlayers}
          />
        )}
      </main>
    </div>
  );
}
