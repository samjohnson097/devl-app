import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { rpcGetIntakeFormData, rpcRegisterPlayer } from '../api/leagueApi';
import { isSupabaseConfigured } from '../lib/supabase';
import { ConfigBanner, Layout } from '../components/Layout';
import { formatAppError } from '../lib/errors';

export function IntakePage() {
  const { slug } = useParams<{ slug: string }>();
  /** undefined = loading, null = not found */
  const [seasonName, setSeasonName] = useState<string | null | undefined>(
    undefined
  );
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [mondays, setMondays] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [agreements, setAgreements] = useState({
    growth: false,
    safeSpace: false,
    genderInclusive: false,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!slug || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await rpcGetIntakeFormData(slug);
        if (cancelled) return;
        if (!row) {
          setSeasonName(null);
          setMondays([]);
          setAvailability({});
          return;
        }
        setSeasonName(row.season_name);
        const dayList = row.monday_dates;
        setMondays(dayList);
        const next: Record<string, boolean> = {};
        for (const d of dayList) next[d] = false;
        setAvailability(next);
      } catch {
        if (!cancelled) setSeasonName(null);
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
    if (!agreements.growth || !agreements.safeSpace || !agreements.genderInclusive) {
      setErr('Please check all three agreements before submitting.');
      return;
    }
    setBusy(true);
    try {
      await rpcRegisterPlayer(
        slug,
        name.trim(),
        email.trim() || null,
        pronouns.trim() || null,
        mondays.map((date) => ({ date, available: !!availability[date] }))
      );
      setDone(true);
      setName('');
      setEmail('');
      setPronouns('');
      const reset: Record<string, boolean> = {};
      for (const d of mondays) reset[d] = false;
      setAvailability(reset);
      setAgreements({ growth: false, safeSpace: false, genderInclusive: false });
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

  if (seasonName === undefined) {
    return (
      <Layout title="Join league">
        <p className="muted">Loading…</p>
      </Layout>
    );
  }

  if (seasonName === null) {
    return (
      <Layout title="Join league">
        <p>This season link is not valid.</p>
      </Layout>
    );
  }

  return (
    <Layout
      title={`Join — ${seasonName}`}
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
          <label className="field">
            <span>Pronouns (optional)</span>
            <input
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              placeholder="e.g., she/her, he/him, they/them"
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
          <fieldset className="fieldset">
            <legend>Agreements</legend>
            <label className="check" style={{ alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={agreements.growth}
                onChange={(e) => {
                  setErr(null);
                  setAgreements((prev) => ({ ...prev, growth: e.target.checked }));
                }}
              />
              <span>
                I will come to volleyball with a desire to grow and support the growth
                of those around me.
              </span>
            </label>
            <label className="check" style={{ alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={agreements.safeSpace}
                onChange={(e) => {
                  setErr(null);
                  setAgreements((prev) => ({ ...prev, safeSpace: e.target.checked }));
                }}
              />
              <span>
                I acknowledge the existence of a spectrum of sexualities, religions,
                and racial identities. I support Dig Easy as a safe space for all
                through my expression of positive dialogue and mindful consideration
                of all players.
              </span>
            </label>
            <label className="check" style={{ alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={agreements.genderInclusive}
                onChange={(e) => {
                  setErr(null);
                  setAgreements((prev) => ({
                    ...prev,
                    genderInclusive: e.target.checked,
                  }));
                }}
              />
              <span>
                I acknowledge the existence of all genders, both inside and outside
                of the typical gender binary, and I will strive to use gender inclusive
                language wherever possible. I will be mindful of my ability to abide
                by these agreements and I will remove myself when I feel like I cannot.
              </span>
            </label>
          </fieldset>
          {err ? <p className="error">{err}</p> : null}
          <button
            className="btn primary"
            type="submit"
            disabled={
              busy ||
              !agreements.growth ||
              !agreements.safeSpace ||
              !agreements.genderInclusive
            }
          >
            {busy ? 'Saving…' : 'Submit'}
          </button>
        </form>
      </section>
    </Layout>
  );
}
