import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';
import { AuthProvider } from './auth/AuthContext';

test('renders home title', () => {
  render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );
  expect(
    screen.getByRole('heading', { name: /dig easy volleyball league/i })
  ).toBeInTheDocument();
});
