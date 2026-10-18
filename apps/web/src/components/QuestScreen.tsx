import { useMatch } from '../hooks/useMatch';
import { StoryScene } from './StoryScene';
import { leaveBattle } from '../story/leaveBattle';
import { navigate, useScreen } from '../hooks/useScreen';
export function QuestScreen() {
  const { lobby, quest, onlineStatus, send, error } = useMatch();
  const screen = useScreen();
  const accepted = !!lobby && !!quest?.accepted.includes(lobby.you);
  const connected = lobby?.mode !== 'online' || (onlineStatus === 'open' && lobby.players.every(player => player.connected));
  const story = quest?.story;
  return <StoryScene title={story?.title ?? 'A whisper from the glade…'}
    paragraphs={[story?.briefing ?? 'One moment, brave adventurer. I’m finding out what your troublesome twin has done this time!']}
    narration={!!story} action={accepted ? 'Quest accepted' : 'Accept my quest'}
    disabled={accepted || !connected || !story} onContinue={() => send({ type: 'quest.accept' })}
    status={!connected ? 'Waiting for both adventurers to reconnect…' : !story ? 'Moss is gathering the latest news…' : accepted ? 'Your sword is ready. Waiting for the other adventurer…' : 'The battle begins when both adventurers accept.'}
    error={error} onLeave={() => void leaveBattle(send, () => {
      if (screen === 'practice') navigate('login');
    })} />;
}
