import { useState } from 'react';
import { useMatch } from '../hooks/useMatch';
import { MOSS_QUEST_CHAT } from '../story/chapters';
import { MossChat } from './MossChat';
import { QuestScreen } from './QuestScreen';

/** After the book closes: Moss pops up in a chat, then hands over the quest scroll to accept. */
export function QuestHandoff() {
  const { quest } = useMatch();
  // Each new round starts with Moss's chat again.
  const [scrollRound, setScrollRound] = useState<number | null>(null);
  const round = quest?.roundNumber ?? null;
  return <div className="entry-layout quest-layout">
    {scrollRound === round ? <QuestScreen /> : <MossChat lines={MOSS_QUEST_CHAT} onContinue={() => setScrollRound(round)} />}
  </div>;
}
