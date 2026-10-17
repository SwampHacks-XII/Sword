import type { ClientMessage, ServerMessage } from './messages';
import { createMockConnection } from './mock/mockConnection';

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/** Everything the website needs from "the server". The mock and the future WebSocket version both implement this. */
export interface GameConnection {
  readonly kind: 'mock' | 'ws';
  status(): ConnectionStatus;
  send(message: ClientMessage): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: (message: ServerMessage) => void): () => void;
  close(): void;
}

export function createConnection(): GameConnection {
  const kind = import.meta.env.VITE_CONNECTION ?? 'mock';
  if (kind === 'ws') {
    throw new Error('VITE_CONNECTION=ws is not built yet. Use mock for now.');
  }
  return createMockConnection();
}
