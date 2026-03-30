import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { formatAppError } from '../lib/errors';
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase';
import { ConfigBanner, Layout } from '../components/Layout';

export function AdminLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session } = useAuth();
  const from =
    (location.state as { from?: string } | null)?.from || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (session) navigate(from, { replace: true });
  }, [session, from, navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const sb = requireSupabase();
      const { error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      navigate(from, { replace: true });
    } catch (er: unknown) {
      setErr(formatAppError(er));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout
      title="Organizer sign in"
      subtitle="Use the shared league admin account from Supabase Authentication."
    >
      {!isSupabaseConfigured ? <ConfigBanner /> : null}
      <section className="card">
        <form className="form" onSubmit={onSubmit}>
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {err ? <p className="error">{err}</p> : null}
          <button
            className="btn primary"
            type="submit"
            disabled={busy || !isSupabaseConfigured}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="hint" style={{ marginTop: '1rem' }}>
          <Link to="/">← Back to league home</Link>
        </p>
      </section>
    </Layout>
  );
}
