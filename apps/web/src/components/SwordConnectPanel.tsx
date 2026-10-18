import type { ReactNode } from 'react';
import type { CheckStatus, DeviceChecks } from '../game/types';
import { SWORD_CHECKS, swordChecksPassed } from '../game/swordCalibration';
import { useMatch } from '../hooks/useMatch';
import { useSerialSword, type SerialSwordStatus } from '../hooks/useSerialSword';

const MARK: Record<CheckStatus, string> = { pending: '·', checking: '…', ok: '✓', failed: '✗' };
type SetupActions = { onContinue(): void; onLeave(): void };

const SWORD_STATUS: Record<SerialSwordStatus, string> = {
  disconnected: 'No sword connected — the keyboard stands in.',
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
      <h1>Connect your sword</h1>
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
        {passed ? 'All four practice checks passed! Your practice sword is ready.'
          : swordReady ? 'Your physical sword is connected and ready.'
          : running ? 'Checking your practice sword…'
          : 'Your sword needs all four checkmarks before you can enter the lobby.'}
      </p>
      <p className="hint">Practice mode: pairing, lights, motion, and camera are simulated. Connect a physical sword below, or battle with your keyboard.</p>
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

function PhysicalSwordControls() {
  const { connectionKind } = useMatch();
  const sword = useSerialSword();
  const plugged = sword.status === 'waiting' || sword.status === 'ready';
  return <>
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
    {connectionKind === 'ws' && sword.status !== 'ready' && <p className="hint">Online keyboard practice. Connect a sword to play with it.</p>}
  </>;
}

export function SwordConnectPanel(actions: SetupActions) {
  const { checks, calibratePracticeSword } = useMatch();
  const sword = useSerialSword();
  return (
    <SwordSetupForm {...actions} checks={checks} onCalibrate={calibratePracticeSword} swordReady={sword.status === 'ready'}>
      <PhysicalSwordControls />
    </SwordSetupForm>
  );
}
