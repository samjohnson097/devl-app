import React from 'react';
import { Link } from 'react-router-dom';

export function Layout(props: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          DEVL
        </Link>
        {props.actions}
      </header>
      <main className="main">
        <div className="page-head">
          <h1>{props.title}</h1>
          {props.subtitle ? <p className="muted">{props.subtitle}</p> : null}
        </div>
        {props.children}
      </main>
    </div>
  );
}

export function ConfigBanner() {
  return (
    <div className="banner warn">
      <strong>Supabase is not configured.</strong> Copy{' '}
      <code>.env.example</code> to <code>.env.local</code>, add your project URL
      and anon key, run <code>supabase/schema.sql</code> in the Supabase SQL
      editor, then restart <code>npm start</code>.
    </div>
  );
}
