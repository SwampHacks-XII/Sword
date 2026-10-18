import type { ReactNode } from 'react';
import { FitText } from './FitText';
import type { CheckStatus, DeviceChecks } from '../game/types';
import { SWORD_CHECKS, swordChecksPassed } from '../game/swordCalibration';
import { useMatch } from '../hooks/useMatch';
import { useSerialSword, type SerialSwordStatus, type SwordTransport } from '../hooks/useSerialSword';

const MARK: Record<CheckStatus, string> = { pending: '·', checking: '…', ok: '✓', failed: '✗' };
type SetupActions = { onContinue(): void; onLeave(): void };

const SWORD_STATUS: Record<SerialSwordStatus, string> = {
  disconnected: '',
  connecting: 'Choose your sword in the browser’s list…',
  waiting: 'Waiting for the sword to start up — hold it upright and still.',
  ready: 'Sword ready. Its buttons and motion drive your spells.',
};

export function SwordSetupForm({ checks, onCalibrate, onContinue, onLeave, swordReady = false, children }: SetupActions & {
  checks: DeviceChecks; onCalibrate(): void;
  /** A physical sword is connected and ready, so practice calibration is optional. */
  swordReady?: boolean;
  /** Controls for connecting a physical sword. */
  children?: ReactNode;
}) {
  const running = SWORD_CHECKS.some(({ id }) => checks[id] === 'checking');
  const passed = swordChecksPassed(checks);
  const canContinue = passed || swordReady;
  return (
    <div className="book-form sword-setup">
      <h1><FitText>Connect your sword</FitText></h1>
      <p className="hint">Wake your sword, hold it steady, and ready your magic. Complete every check to continue.</p>
      <ul className="checklist" aria-label="Sword readiness checklist">
        {SWORD_CHECKS.map(({ id, label }) => (
          <li key={id} className={`check check-${checks[id]}`}>
            <span>{label}</span>
            <span className="check-mark" aria-label={checks[id]}>{MARK[checks[id]]}</span>
          </li>
        ))}
      </ul>
      <div className="sword-setup-actions">
        <button type="button" className="secondary-button" disabled={running} onClick={onCalibrate}>
          {running ? 'Calibrating…' : passed ? 'Calibrate again' : 'Calibrate practice sword'}
        </button>
      </div>
      <p className="hint sword-setup-status" role="status">
        {passed ? 'All four practice checks passed!'
          : swordReady ? 'Your physical sword is connected and ready.'
          : running ? 'Checking your practice sword…'
          : ''}
      </p>
      <h2 className="sword-connection-title">Sword Connection</h2>
      {children}
      <div className="sword-setup-actions">
        <button type="button" className="quest-button" disabled={!canContinue} onClick={() => { if (canContinue) onContinue(); }}>
          Connect your sword <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="link-button small" onClick={onLeave}>Back to game choices</button>
      </div>
    </div>
  );
}

const TRANSPORT_LABEL: Record<SwordTransport, string> = { bluetooth: 'Bluetooth', usb: 'USB' };

function SwordConnectionOptions({ onKeyboard }: { onKeyboard(): void }) {
  const { connectionKind } = useMatch();
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
        Keyboard <span aria-hidden="true">→</span>
      </button>
    </div>
    {SWORD_STATUS[sword.status] && <p className="hint" role="status">{SWORD_STATUS[sword.status]}</p>}
    {!sword.supported.bluetooth && !sword.supported.usb && <p className="hint">To use a physical sword, open the game in Chrome or Edge.</p>}
    {sword.error && <p className="error" role="alert">{sword.error}</p>}
    {connectionKind === 'ws' && sword.status !== 'ready' && <p className="hint">Online keyboard practice. Connect a sword to play with it.</p>}
  </>;
}

export function SwordConnectPanel(actions: SetupActions) {
  const { checks, calibratePracticeSword } = useMatch();
  const sword = useSerialSword();
  return (
    <SwordSetupForm {...actions} checks={checks} onCalibrate={calibratePracticeSword} swordReady={sword.status === 'ready'}>
      <SwordConnectionOptions onKeyboard={actions.onContinue} />
    </SwordSetupForm>
  );
}
