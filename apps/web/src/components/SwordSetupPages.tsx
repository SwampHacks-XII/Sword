import type { BookSpread } from './BookMenu';
import { SwordConnectPanel } from './SwordConnectPanel';
import { NpcGuide } from './NpcGuide';

export function swordSetupSpread(onContinue: () => void, onLeave: () => void): BookSpread {
  return {
    left: {
      kicker: 'Before your adventure', title: 'Wait! You need your sword!',
      content: <div className="book-art sword-setup-art">
        <img className="book-art-knight" src="/art/knight.svg" alt="A knight holding a magic sword" />
        <NpcGuide message="A brave heart is a good start. Now, let’s ready your magic!" />
      </div>,
    },
    right: {
      kicker: 'Ready your magic', className: 'book-page-dense',
      content: <SwordConnectPanel onContinue={onContinue} onLeave={onLeave} />,
    },
  };
}
