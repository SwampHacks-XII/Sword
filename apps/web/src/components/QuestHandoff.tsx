import { QuestScreen } from './QuestScreen';

/** The book closes straight into the shared quest briefing and acceptance screen. */
export function QuestHandoff() {
  return <div className="entry-layout quest-layout">
    <QuestScreen />
  </div>;
}
