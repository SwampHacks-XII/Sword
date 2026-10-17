import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useSession } from '../auth/SessionProvider';
import { createApi } from '../net/api';
import { createPlayerName } from '../net/playerName';

export function usePlayerName() {
  const session = useSession();
  const token = useRef(session.getToken); token.current = session.getToken;
  // Token refreshes must not discard an in-progress edit; changing accounts must.
  const editor = useMemo(() => createPlayerName(session.authenticated ? createApi(() => token.current()) : null,
    session.authenticated ? session.name : 'Player 1'), [session.subject, session.authenticated]);
  const state = useSyncExternalStore(editor.subscribe, editor.snapshot, editor.snapshot);
  useEffect(() => {
    if (!session.loading) void editor.load();
    return () => editor.cancelPending();
  }, [editor, session.loading]);
  return { ...state, change: editor.change, edit: editor.edit, cancel: editor.cancel, save: editor.save, retry: editor.load };
}
