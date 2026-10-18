import type { ReactNode } from 'react';
import { FitText } from './FitText';
import { useSerialSword, type SerialSwordStatus, type SwordTransport } from '../hooks/useSerialSword';
import { SWORD_COLOR_NAMES } from '../game/swordColors';

type SetupActions = { onContinue(): void; onLeave(): void };

const SWORD_STATUS: Record<SerialSwordStatus, string> = {
  disconnected: '',
  connecting: 'Choose your sword in the browser’s list…',
  waiting: 'Connecting to your sword…',
  ready: 'Sword ready. Its buttons and motion drive your spells.',
};

export function SwordSetupForm({ onContinue, onLeave, swordReady = false, children }: SetupActions & {
  swordReady?: boolean; children?: ReactNode;
}) {
  return <div className="book-form sword-setup">
    <h1><FitText>Connect your sword</FitText></h1>
    {children}
    <div className="sword-setup-actions">
      {swordReady && <button type="button" className="quest-button" onClick={onContinue}>Continue</button>}
      <button type="button" className="link-button small" onClick={onLeave}>Back to game choices</button>
    </div>
  </div>;
}

const TRANSPORT_LABEL: Record<SwordTransport, string> = { bluetooth: 'Bluetooth', usb: 'USB' };

function SwordConnectionOptions({ onKeyboard }: { onKeyboard(): void }) {
  const sword = useSerialSword();
  const plugged = sword.status === 'waiting' || sword.status === 'ready';
  const swordOption = (transport: SwordTransport) => {
    const active = plugged && sword.transport === transport;
    return (
      <button type="button" className={`secondary-button sword-connection-option${active ? ' is-active' : ''}`}
        disabled={!sword.supported[transport] || sword.status === 'connecting' || (plugged && !active)}
        aria-pressed={active} onClick={() => active ? sword.disconnect() : sword.connect(transport)}>
        {active ? `Disconnect ${TRANSPORT_LABEL[transport]}` : TRANSPORT_LABEL[transport]}
      </button>
    );
  };
  return <>
    <div className="sword-connection-options" role="group" aria-label="Sword Connection">
      {swordOption('bluetooth')}
      {swordOption('usb')}
      <button type="button" className="secondary-button sword-connection-option" onClick={onKeyboard}>
        Keyboard
      </button>
    </div>
    {SWORD_STATUS[sword.status] && <p className="hint" role="status">
      {sword.status === 'ready' && sword.swordNumber
        // The real SWORD_ID from the sword itself; the browser's Bluetooth list can show an old cached name.
        ? `Sword ${sword.swordNumber} (${SWORD_COLOR_NAMES[sword.swordNumber]}) ready. Its buttons and motion drive your spells.`
        : SWORD_STATUS[sword.status]}
    </p>}
    {!sword.supported.bluetooth && !sword.supported.usb && <p className="hint">To use a physical sword, open the game in Chrome or Edge.</p>}
    {sword.error && <p className="error" role="alert">{sword.error}</p>}
  </>;
}

export function SwordConnectPanel(actions: SetupActions) {
  const sword = useSerialSword();
  return (
    <SwordSetupForm {...actions} swordReady={sword.status === 'ready'}>
      <SwordConnectionOptions onKeyboard={actions.onContinue} />
    </SwordSetupForm>
  );
}
