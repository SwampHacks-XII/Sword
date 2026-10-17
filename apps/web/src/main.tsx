import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ConnectionProvider } from './net/ConnectionProvider';
import './styles.css';
import { SessionProvider } from './auth/SessionProvider';
import { SerialSwordProvider } from './hooks/useSerialSword';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <ConnectionProvider><SerialSwordProvider><App /></SerialSwordProvider></ConnectionProvider>
    </SessionProvider>
  </StrictMode>,
);
