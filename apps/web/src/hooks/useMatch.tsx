import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { DeviceChecks, LobbyState, MatchEvent, MatchState, PlayerSlot } from '../game/types';
import type { ClientMessage, ServerMessage } from '../net/messages';
import { useConnection } from './useConnection';

export interface LogEntry { id: number; event: MatchEvent }

/** Everything the screens render. Built only from server messages. */
export interface GameView {
  lobby: LobbyState | null;
  checks: DeviceChecks;
  match: MatchState | null;
  log: LogEntry[];
  /** Local receive time of the last damaging hit per player, for flash effects. */
  lastHitAt: Partial<Record<PlayerSlot, number>>;
  error: string | null;
  pending: boolean;
  onlineStatus: 'connecting' | 'open' | 'closed';
}

interface MatchContextValue extends GameView {
  send: (message: ClientMessage) => void;
  connectionKind: 'mock' | 'ws';
}

const initialView: GameView = {
  lobby: null,
  checks: { pairing: 'pending', lights: 'pending', motion: 'pending', camera: 'pending' },
  match: null,
  log: [],
  lastHitAt: {},
  error: null,
  pending: false,
  onlineStatus: 'closed',
};

let logId = 0;

function reduce(view: GameView, { message, receivedAt }: { message: ServerMessage; receivedAt: number }): GameView {
  switch (message.type) {
    case 'action.pending': return { ...view, pending: message.pending, ...(message.pending ? { error: null } : {}) };
    case 'connection.state': return { ...view, onlineStatus: message.status };
    case 'room.closed': return { ...initialView, error: message.message };
    case 'lobby.state':
      return { ...view, lobby: message.lobby, error: null };
    case 'device.state':
      return { ...view, checks: message.checks };
    case 'match.state': {
      const restarted = message.match?.phase === 'fighting' && view.match?.phase !== 'fighting';
      return { ...view, match: message.match, ...(restarted || !message.match ? { log: [], lastHitAt: {} } : {}) };
    }
    case 'match.event': {
      const { event } = message;
      const log = [...view.log.slice(-4), { id: ++logId, event }];
      if (event.kind === 'hit' && !event.blocked) {
        return { ...view, log, lastHitAt: { ...view.lastHitAt, [event.victim]: receivedAt } };
      }
      return { ...view, log };
    }
    case 'error':
      return { ...view, error: message.message };
    case 'sword.pose':
      return view;
  }
}

const MatchContext = createContext<MatchContextValue | null>(null);

export function MatchProvider({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const [view, dispatch] = useReducer(reduce, initialView);

  useEffect(() => connection.subscribe((message) => {
    // Poses go to the pose store, not React state.
    if (message.type !== 'sword.pose') dispatch({ message, receivedAt: Date.now() });
  }), [connection]);

  const send = useCallback((message: ClientMessage) => connection.send(message), [connection]);
  const value = useMemo<MatchContextValue>(
    () => ({ ...view, send, connectionKind: connection.kind }),
    [view, send, connection],
  );

  return <MatchContext value={value}>{children}</MatchContext>;
}

export function useMatch(): MatchContextValue {
  const value = useContext(MatchContext);
  if (!value) throw new Error('useMatch must be used inside <MatchProvider>.');
  return value;
}
