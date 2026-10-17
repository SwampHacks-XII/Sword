import type { ClientMessage, ServerMessage } from './messages';
import { createMockConnection } from './mock/mockConnection';
import { createOnlineConnection } from './onlineConnection';
import type { Api } from './api';

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

export function createConnection(api: Api): GameConnection {
  const listeners = new Set<(message: ServerMessage) => void>();
  let active: ReturnType<typeof createMockConnection> | ReturnType<typeof createOnlineConnection> | null = null;
  let kind: 'mock' | 'ws' = 'mock';
  let unsubscribe: (() => void) | undefined;
  let busy = false;
  let closed = false;
  let version = 0;
  const emit = (message: ServerMessage) => {
    if (closed) return;
    if (message.type === 'lobby.state' && message.lobby) message = { ...message, lobby: { ...message.lobby, mode: kind === 'mock' ? 'bot' : 'online' } };
    listeners.forEach(listener => listener(message));
  };
  const clear = () => { version++; unsubscribe?.(); active?.close(); active = null; };
  return {
    get kind() { return kind; },
    status: () => active?.status() ?? 'closed',
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    send(message) {
      if (closed || busy) return;
      if (message.type === 'lobby.create' || message.type === 'lobby.join') {
        clear(); busy = true;
        const currentVersion = version;
        const scopedEmit = (message: ServerMessage) => { if (version === currentVersion) emit(message); };
        kind = message.type === 'lobby.create' && message.mode === 'bot' ? 'mock' : 'ws';
        emit({ type: 'action.pending', pending: true });
        if (kind === 'mock') {
          const mock = createMockConnection(); active = mock; unsubscribe = mock.subscribe(emit);
          mock.send(message); busy = false; emit({ type: 'action.pending', pending: false });
        } else {
          const online = createOnlineConnection(api, scopedEmit); active = online;
          void online.enter(message).catch(error => {
            if (version !== currentVersion) return;
            clear(); emit({ type: 'lobby.state', lobby: null }); emit({ type: 'match.state', match: null });
            emit({ type: 'error', message: error instanceof Error ? error.message : 'Could not join the room.' });
          }).finally(() => { busy = false; emit({ type: 'action.pending', pending: false }); });
        }
      } else active?.send(message);
    },
    close() { closed = true; clear(); listeners.clear(); },
  };
}
