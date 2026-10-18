import type { BookSpread } from './BookMenu';
import { SwordConnectPanel } from './SwordConnectPanel';
import { NpcGuide } from './NpcGuide';
import { Knight } from './Knight';

export function swordSetupSpread(onContinue: () => void, onLeave: () => void): BookSpread {
  return {
    left: {
      kicker: 'Before your adventure', title: 'Wait! You need your sword!',
      content: <div className="book-art sword-setup-art">
        <Knight className="book-art-knight" label="A knight holding a magic sword" />
        <NpcGuide message="A brave heart is a good start. Now, let’s ready your magic!" />
      </div>,
    },
    right: {
      kicker: 'Ready your magic', className: 'book-page-dense',
      content: <SwordConnectPanel onContinue={onContinue} onLeave={onLeave} />,
    },
  };
}
