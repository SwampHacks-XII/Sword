import { createContext, useContext } from 'react';
import type { GameConnection } from '../net/connection';
import type { PoseStore } from './useSwordPoses';

export interface ConnectionContextValue {
  connection: GameConnection;
  poses: PoseStore;
}

export const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function useConnection(): ConnectionContextValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error('useConnection must be used inside <ConnectionProvider>.');
  return value;
}
