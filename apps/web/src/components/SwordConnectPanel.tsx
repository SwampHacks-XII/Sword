import type { CheckId, CheckStatus } from '../game/types';
import { useMatch } from '../hooks/useMatch';
import { useSerialSword, type SerialSwordStatus } from '../hooks/useSerialSword';
import { Parchment } from './Parchment';

const CHECKS: { id: CheckId; label: string }[] = [
  { id: 'pairing', label: 'Pairing' },
  { id: 'lights', label: 'Test Lights' },
  { id: 'motion', label: 'Motion' },
  { id: 'camera', label: 'Camera' },
];

const MARK: Record<CheckStatus, string> = { pending: '·', checking: '…', ok: '✓', failed: '✗' };

const SWORD_STATUS: Record<SerialSwordStatus, string> = {
  disconnected: 'No sword connected — the keyboard stands in.',
  connecting: 'Choose your sword in the browser’s list…',
  waiting: 'Waiting for the sword to start up — hold it upright and still.',
  ready: 'Sword ready. Its buttons and motion drive your spells.',
};

export function SwordConnectPanel() {
  const { checks, send, connectionKind } = useMatch();
  const sword = useSerialSword();
  const running = Object.values(checks).some((s) => s === 'checking');
  const plugged = sword.status === 'waiting' || sword.status === 'ready';
  return (
    <Parchment title="Ready your magic" className="connect-panel">
      <ul className="checklist">
        {CHECKS.map(({ id, label }) => (
          <li key={id} className={`check check-${checks[id]}`}>
            <span>{label}</span>
            <span className="check-mark" aria-label={checks[id]}>{MARK[checks[id]]}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="link-button" disabled={running || connectionKind === 'ws'} onClick={() => send({ type: 'device.check' })}>
        {running ? 'Checking…' : 'Run check'}
      </button>
      {sword.supported.bluetooth || sword.supported.usb ? <>
        {plugged
          ? <button type="button" className="link-button" onClick={sword.disconnect}>
            Disconnect sword ({sword.transport === 'usb' ? 'USB' : 'Bluetooth'})
          </button>
          : <>
            {sword.supported.bluetooth && <button type="button" className="link-button" disabled={sword.status === 'connecting'}
              onClick={() => sword.connect('bluetooth')}>Connect sword (Bluetooth)</button>}
            {sword.supported.usb && <button type="button" className="link-button small" disabled={sword.status === 'connecting'}
              onClick={() => sword.connect('usb')}>Connect sword (USB cable)</button>}
          </>}
        <p className="hint" role="status">{SWORD_STATUS[sword.status]}</p>
      </> : <p className="hint">To use a physical sword, open the game in Chrome or Edge.</p>}
      {sword.error && <p className="error" role="alert">{sword.error}</p>}
      {connectionKind === 'mock' && sword.status !== 'ready' && <p className="hint">Simulated sword — no hardware needed.</p>}
      {connectionKind === 'ws' && sword.status !== 'ready' && <p className="hint">Online keyboard practice. Connect a sword to play with it.</p>}
    </Parchment>
  );
}
