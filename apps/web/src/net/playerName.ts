import { ApiRequestError, type Api, type Profile } from './api';

export interface PlayerNameState {
  status: 'loading' | 'ready' | 'editing' | 'saving' | 'error';
  authenticated: boolean;
  savedName: string | null;
  draft: string;
  error: string | null;
}

/** One account's name editor. Only a successful server save replaces the saved name. */
export function createPlayerName(api: Api | null, suggestedName = 'Player 1') {
  const initialDraft = suggestedName.trim().slice(0, 40) || 'Player 1';
  let state: PlayerNameState = {
    status: api ? 'loading' : 'editing', authenticated: !!api, savedName: null, draft: initialDraft, error: null,
  };
  const listeners = new Set<() => void>();
  let version = 0;
  function update(next: Partial<PlayerNameState>) { state = { ...state, ...next }; listeners.forEach(listener => listener()); }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancelPending() { version++; },
    async load() {
      if (!api) return;
      const request = ++version;
      update({ status: 'loading', savedName: null, draft: initialDraft, error: null });
      try {
        const { player } = await api.request<{ player: Profile }>('/me');
        if (request === version) update({ status: 'ready', savedName: player.displayName, draft: player.displayName });
      } catch (error) {
        if (request !== version) return;
        if (error instanceof ApiRequestError && error.status === 404) update({ status: 'editing' });
        else update({ status: 'error', error: 'Couldn’t load your saved name. Try again.' });
      }
    },
    change(draft: string) { if (state.status === 'editing') update({ draft, error: null }); },
    edit() { if (state.status === 'ready') update({ status: 'editing', draft: state.savedName!, error: null }); },
    cancel() {
      if (state.status === 'editing' && state.savedName !== null) update({ status: 'ready', draft: state.savedName, error: null });
    },
    async save() {
      if (!api || state.status !== 'editing') return false;
      const displayName = state.draft.trim();
      if (!displayName || displayName.length > 40) { update({ error: 'Choose a name with 1–40 characters.' }); return false; }
      const request = ++version;
      update({ status: 'saving', error: null });
      try {
        const { player } = await api.request<{ player: Profile }>('/me', 'PUT', { displayName });
        if (request !== version) return false;
        update({ status: 'ready', savedName: player.displayName, draft: player.displayName });
        return true;
      } catch {
        if (request === version) update({ status: 'editing', error: 'Couldn’t save your name. Your changes are still here—try again.' });
        return false;
      }
    },
  };
}
