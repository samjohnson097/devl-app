import React from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import './App.css';
import { RequireAdmin } from './components/RequireAdmin';
import { HomePage } from './pages/HomePage';
import { IntakePage } from './pages/IntakePage';
import { AdminSeasonPage } from './pages/AdminSeasonPage';
import { GameNightPage } from './pages/GameNightPage';
import { GameNightSharePage } from './pages/GameNightSharePage';
import { AdminLoginPage } from './pages/AdminLoginPage';

function LegacyAdminRedirect() {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={`/league/${slug}/admin`} replace />;
}

function LegacyNightRedirect() {
  const { slug, nightId } = useParams<{
    slug: string;
    token: string;
    nightId: string;
  }>();
  if (!slug || !nightId) return <Navigate to="/" replace />;
  return (
    <Navigate to={`/league/${slug}/admin/night/${nightId}`} replace />
  );
}

function App() {
  return (
    <>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/league/:slug/join" element={<IntakePage />} />
        <Route
          path="/league/:slug/admin"
          element={
            <RequireAdmin>
              <AdminSeasonPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/league/:slug/admin/night/:nightId"
          element={
            <RequireAdmin>
              <GameNightPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/league/:slug/admin/night/:nightId/sheet"
          element={
            <RequireAdmin>
              <GameNightSharePage />
            </RequireAdmin>
          }
        />
        <Route
          path="/league/:slug/admin/:token"
          element={<LegacyAdminRedirect />}
        />
        <Route
          path="/league/:slug/admin/:token/night/:nightId"
          element={<LegacyNightRedirect />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    <Analytics />
    <SpeedInsights />
    </>
  );
}

export default App;
