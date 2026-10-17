import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConnectionContext, type ConnectionContextValue } from '../hooks/useConnection';
import { MatchProvider } from '../hooks/useMatch';
import { createPoseStore } from '../hooks/useSwordPoses';
import { createConnection } from './connection';
import { createApi } from './api';
import { useSession } from '../auth/SessionProvider';
import { fallbackQuest, type QuestStory } from '@sword/protocol';

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const token = useRef(session.getToken);
  token.current = session.getToken;
  const authenticated = useRef(session.authenticated);
  authenticated.current = session.authenticated;
  const [value, setValue] = useState<ConnectionContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Created in an effect (not during render) so React StrictMode's remount gets a fresh connection.
  useEffect(() => {
    let connection;
    try {
      const api = createApi(() => token.current());
      connection = createConnection(api, async (sessionId, roundNumber) => {
        if (!authenticated.current) return fallbackQuest(roundNumber);
        const result = await api.request<{ story: QuestStory }>('/quests/story', 'POST', { sessionId, roundNumber });
        return result.story;
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect.');
      return;
    }
    const poses = createPoseStore();
    const unsubscribe = connection.subscribe((message) => {
      if (message.type === 'sword.pose') poses[message.slot] = message.q;
    });
    setValue({ connection, poses });
    return () => {
      unsubscribe();
      connection.close();
      setValue(null);
    };
  }, []);

  if (error) return <p className="fatal">{error}</p>;
  if (!value) return null;
  return (
    <ConnectionContext value={value}>
      <MatchProvider>{children}</MatchProvider>
    </ConnectionContext>
  );
}
