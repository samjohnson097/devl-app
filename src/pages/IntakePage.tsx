import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fetchSeasonBySlug,
  fetchSeasonIntakeMondays,
  rpcRegisterPlayer,
} from '../api/leagueApi';
import { isSupabaseConfigured } from '../lib/supabase';
import type { SeasonRow } from '../api/leagueApi';
import { ConfigBanner, Layout } from '../components/Layout';
import { formatAppError } from '../lib/errors';

export function IntakePage() {
  const { slug } = useParams<{ slug: string }>();
  const [season, setSeason] = useState<SeasonRow | null | undefined>(undefined);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mondays, setMondays] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!slug || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await fetchSeasonBySlug(slug);
        if (!cancelled) setSeason(s);
        if (s && !cancelled) {
          const dates = await fetchSeasonIntakeMondays(s.id);
          const dayList = dates.map((d) => d.monday_date);
          setMondays(dayList);
          const next: Record<string, boolean> = {};
          for (const d of dayList) next[d] = false;
          setAvailability(next);
        }
      } catch {
        if (!cancelled) setSeason(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return;
    setErr(null);
    setBusy(true);
    try {
      await rpcRegisterPlayer(
        slug,
        name.trim(),
        email.trim() || null,
        mondays.map((date) => ({ date, available: !!availability[date] }))
      );
      setDone(true);
      setName('');
      setEmail('');
      const reset: Record<string, boolean> = {};
      for (const d of mondays) reset[d] = false;
      setAvailability(reset);
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  if (!slug) {
    return (
      <Layout title="Join league">
        <p>Invalid link.</p>
      </Layout>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <Layout title="Join league">
        <ConfigBanner />
      </Layout>
    );
  }

  if (season === undefined) {
    return (
      <Layout title="Join league">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  if (season === null) {
    return (
      <Layout title="Join league">
        <p>This season link is not valid.</p>
      </Layout>
    );
  }

  return (
    <Layout
      title={`Join — ${season.name}`}
      subtitle="Tell us your availability for the next 8 Mondays."
    >
      {done ? (
        <div className="card success-card">
          <p>You’re on the list. See you on the court.</p>
        </div>
      ) : null}

      <section className="card">
        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={1}
              placeholder="Alex Kim"
            />
          </label>
          <label className="field">
            <span>Email (optional)</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <fieldset className="fieldset">
            <legend>Upcoming Mondays</legend>
            {mondays.map((date) => (
              <label className="check" key={date}>
                <input
                  type="checkbox"
                  checked={!!availability[date]}
                  onChange={(e) =>
                    setAvailability((prev) => ({
                      ...prev,
                      [date]: e.target.checked,
                    }))
                  }
                />
                {new Date(`${date}T00:00:00`).toLocaleDateString()}
              </label>
            ))}
          </fieldset>
          {err ? <p className="error">{err}</p> : null}
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Submit'}
          </button>
        </form>
      </section>
    </Layout>
  );
}
