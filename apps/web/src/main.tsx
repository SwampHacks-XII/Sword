import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ConnectionProvider } from './net/ConnectionProvider';
import './styles.css';
import { SessionProvider } from './auth/SessionProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <ConnectionProvider><App /></ConnectionProvider>
    </SessionProvider>
  </StrictMode>,
);
