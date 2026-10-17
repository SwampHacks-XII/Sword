import type { CheckId, CheckStatus } from '../game/types';
import { useMatch } from '../hooks/useMatch';
import { Parchment } from './Parchment';

const CHECKS: { id: CheckId; label: string }[] = [
  { id: 'pairing', label: 'Pairing' },
  { id: 'lights', label: 'Test Lights' },
  { id: 'motion', label: 'Motion' },
  { id: 'camera', label: 'Camera' },
];

const MARK: Record<CheckStatus, string> = { pending: '·', checking: '…', ok: '✓', failed: '✗' };

export function SwordConnectPanel() {
  const { checks, send, connectionKind } = useMatch();
  const running = Object.values(checks).some((s) => s === 'checking');
  return (
    <Parchment title="Sword Connect" className="connect-panel">
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
      {connectionKind === 'mock' && <p className="hint">Simulated sword — no hardware needed.</p>}
      {connectionKind === 'ws' && <p className="hint">Online keyboard practice. Physical swords and camera tracking are not connected yet.</p>}
    </Parchment>
  );
}
