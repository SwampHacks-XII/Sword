import type { CheckStatus, DeviceChecks } from '../game/types';
import { SWORD_CHECKS, swordChecksPassed } from '../game/swordCalibration';
import { useMatch } from '../hooks/useMatch';

const MARK: Record<CheckStatus, string> = { pending: '·', checking: '…', ok: '✓', failed: '✗' };
type SetupActions = { onContinue(): void; onLeave(): void };

export function SwordSetupForm({ checks, onCalibrate, onContinue, onLeave }: SetupActions & {
  checks: DeviceChecks; onCalibrate(): void;
}) {
  const running = SWORD_CHECKS.some(({ id }) => checks[id] === 'checking');
  const passed = swordChecksPassed(checks);
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
          : running ? 'Checking your practice sword…'
          : 'Your sword needs all four checkmarks before you can enter the lobby.'}
      </p>
      <p className="hint">Practice mode: pairing, lights, motion, and camera are simulated. Physical hardware and camera connection are coming soon; battles use your keyboard.</p>
      <div className="sword-setup-actions">
        <button type="button" className="quest-button" disabled={!passed} onClick={() => { if (passed) onContinue(); }}>
          Connect your sword <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="link-button small" onClick={onLeave}>Back to game choices</button>
      </div>
    </div>
  );
}

export function SwordConnectPanel(actions: SetupActions) {
  const { checks, calibratePracticeSword } = useMatch();
  return <SwordSetupForm {...actions} checks={checks} onCalibrate={calibratePracticeSword} />;
}
