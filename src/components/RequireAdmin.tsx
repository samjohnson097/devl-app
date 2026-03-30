import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { isSupabaseConfigured } from '../lib/supabase';
import { ConfigBanner, Layout } from './Layout';

export function RequireAdmin(props: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (!isSupabaseConfigured) {
    return (
      <Layout title="Admin">
        <ConfigBanner />
      </Layout>
    );
  }

  if (loading) {
    return (
      <Layout title="Admin">
        <p className="muted">Checking session…</p>
      </Layout>
    );
  }

  if (!session) {
    return (
      <Navigate
        to="/admin/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }

  return <>{props.children}</>;
}
