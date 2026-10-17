import type { ClientMessage, ServerMessage } from './messages';
import { apiBaseUrl, type Api, type ApiMatch } from './api';

/** HTTP creates/joins persistent matches. A single-use ticket authenticates the live socket. */
export function createOnlineConnection(api: Api, emit: (message: ServerMessage) => void) {
  let socket: WebSocket | null = null;
  let matchId: string | null = null;
  let stopped = false;
  let generation = 0;
  let reconnects = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let status: 'connecting' | 'open' | 'closed' = 'closed';
  const setStatus = (next: typeof status) => { status = next; emit({ type: 'connection.state', status }); };
  function stop() {
    stopped = true; generation++;
    clearTimeout(retryTimer); clearTimeout(connectTimer);
    socket?.close(); socket = null;
    status = 'closed';
  }
  function scheduleReconnect() {
    if (stopped) return;
    if (++reconnects > 15) {
      emit({ type: 'room.closed', message: 'Could not reconnect. Create or join a room to play again.' }); stop(); return;
    }
    setStatus('connecting');
    retryTimer = setTimeout(() => {
      void connect().catch(() => { if (!stopped) scheduleReconnect(); });
    }, 1500);
  }
  async function connect() {
    const attempt = ++generation;
    setStatus('connecting');
    const { ticket } = await api.request<{ ticket: string }>('/realtime-ticket', 'POST');
    if (stopped || attempt !== generation) return;
    const address = new URL('/realtime', apiBaseUrl);
    address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(address);
      socket = ws;
      let ready = false;
      let settled = false;
      const fail = (message: string) => {
        if (!settled) { settled = true; reject(new Error(message)); }
      };
      connectTimer = setTimeout(() => { fail('The live connection timed out. Please try joining again.'); ws.close(); }, 10_000);
      ws.onopen = () => ws.send(JSON.stringify({ type: 'session.auth', ticket }));
      ws.onerror = () => fail('Cannot open the live connection. Check the server address and allowed website URL.');
      ws.onmessage = event => {
        if (attempt !== generation) return;
        let message: ServerMessage | { type: 'session.ready' } | { type: 'room.ready' };
        try { message = JSON.parse(event.data); } catch { return; }
        if (stopped && message.type !== 'room.closed') return;
        if (message.type === 'session.ready') ws.send(JSON.stringify({ type: 'room.subscribe', matchId }));
        else if (message.type === 'room.ready') {
          clearTimeout(connectTimer); ready = true; settled = true; reconnects = 0;
          setStatus('open'); resolve();
        } else if (message.type === 'room.closed') { if (!stopped) emit(message); stop(); }
        else {
          emit(message);
          if (message.type === 'error' && !ready) { fail(message.message); stopped = true; ws.close(); }
        }
      };
      ws.onclose = event => {
        clearTimeout(connectTimer);
        if (stopped || attempt !== generation) return;
        setStatus('closed');
        if (!ready) { fail('The live connection closed. Try joining the room again.'); return; }
        if (event.code === 1008) {
          stopped = true;
          emit({ type: 'room.closed', message: 'The connection ended. Sign in if needed, then create or join a room.' });
          return;
        }
        scheduleReconnect();
      };
    });
  }
  return {
    status: () => status,
    async enter(message: Extract<ClientMessage, { type: 'lobby.create' | 'lobby.join' }>) {
      await api.request('/me', 'PUT', { displayName: message.name });
      const { match } = message.type === 'lobby.create'
        ? await api.request<{ match: ApiMatch }>('/matches', 'POST', {})
        : await api.request<{ match: ApiMatch }>('/matches/join', 'POST', { joinCode: message.code });
      matchId = match.id;
      await connect();
    },
    send(message: ClientMessage) {
      if (message.type === 'lobby.leave') {
        stop();
        if (matchId) void api.request(`/matches/${matchId}/leave`, 'POST', {}).catch(() => {
          emit({ type: 'error', message: 'You left locally, but the server could not close the room. It will expire after the connection timeout.' });
        });
        emit({ type: 'lobby.state', lobby: null }); emit({ type: 'match.state', match: null });
        return;
      }
      if (status !== 'open' || socket?.readyState !== WebSocket.OPEN) {
        emit({ type: 'error', message: 'Reconnecting to the game server…' }); return;
      }
      socket.send(JSON.stringify(message));
    },
    close: stop,
  };
}
