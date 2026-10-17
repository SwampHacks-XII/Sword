import { QUEST_BRIEFING } from '../story/chapters';
import { useMatch } from '../hooks/useMatch';
import { StoryScene } from './StoryScene';
export function QuestScreen() {
  const { lobby, quest, onlineStatus, send, error } = useMatch();
  const accepted = !!lobby && !!quest?.accepted.includes(lobby.you);
  const connected = lobby?.mode !== 'online' || (onlineStatus === 'open' && lobby.players.every(player => player.connected));
  return <StoryScene title={QUEST_BRIEFING.title} paragraphs={QUEST_BRIEFING.text}
    action={accepted ? 'Quest accepted' : 'Accept my quest'}
    disabled={accepted || !connected} onContinue={() => send({ type: 'quest.accept' })}
    status={!connected ? 'Waiting for both adventurers to reconnect…' : accepted ? 'Your sword is ready. Waiting for the other adventurer…' : 'The battle begins when both adventurers accept.'}
    error={error} onLeave={() => send({ type: 'lobby.leave' })} />;
}
