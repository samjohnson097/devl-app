import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  rpcGetIntakeFormData,
  rpcGetPlayerIntakeByEmail,
  rpcRegisterPlayer,
} from '../api/leagueApi';
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
  const [loadBusy, setLoadBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

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

  async function loadExistingSchedule() {
    if (!slug) return;
    const trimmed = email.trim();
    if (!trimmed) {
      setErr('Enter the email you registered with, then load your schedule.');
      return;
    }
    setErr(null);
    setDoneMessage(null);
    setLoadBusy(true);
    try {
      const row = await rpcGetPlayerIntakeByEmail(slug, trimmed);
      if (!row) {
        setErr(
          'No roster entry found for that email. Check the spelling, or submit as a new player.'
        );
        return;
      }
      setName(row.displayName);
      setPronouns(row.pronouns ?? '');
      setAvailability((prev) => {
        const next: Record<string, boolean> = {};
        for (const d of mondays) next[d] = false;
        for (const a of row.availability) {
          if (a.date in next || mondays.includes(a.date)) {
            next[a.date] = a.available;
          }
        }
        // Keep any Monday keys from the form that weren't in the response.
        for (const d of Object.keys(prev)) {
          if (!(d in next)) next[d] = false;
        }
        return next;
      });
      setDoneMessage(
        'Loaded your saved schedule. Update the Mondays below and submit to save.'
      );
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setLoadBusy(false);
    }
  }

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
      const result = await rpcRegisterPlayer(
        slug,
        name.trim(),
        email.trim() || null,
        pronouns.trim() || null,
        mondays.map((date) => ({ date, available: !!availability[date] }))
      );
      setDoneMessage(
        result.updated
          ? 'Your availability was updated. You’re still on the roster—no duplicate entry.'
          : 'You’re on the list. See you on the court.'
      );
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
      subtitle="Tell us your Monday availability. Already registered? Use the same email to update without creating a new entry."
    >
      {doneMessage ? (
        <div className="card success-card">
          <p>{doneMessage}</p>
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
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <span className="hint" style={{ marginTop: '0.35rem' }}>
              Use the same email when you update later (e.g. after a new night is
              added). Optional for first-time join, but recommended.
            </span>
          </label>
          <div className="actions-row" style={{ marginTop: 0 }}>
            <button
              type="button"
              className="btn secondary"
              disabled={loadBusy || busy || !email.trim()}
              onClick={() => void loadExistingSchedule()}
            >
              {loadBusy ? 'Loading…' : 'Load my schedule'}
            </button>
          </div>
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
