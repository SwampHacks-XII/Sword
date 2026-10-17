import type { CheckId, CheckStatus, DeviceChecks } from './types';

export const SWORD_CHECKS: { id: CheckId; label: string }[] = [
  { id: 'pairing', label: 'Pairing' },
  { id: 'lights', label: 'Test Lights' },
  { id: 'motion', label: 'Motion' },
  { id: 'camera', label: 'Camera' },
];

export function swordChecksPassed(checks: Partial<Record<CheckId, CheckStatus>>): boolean {
  return SWORD_CHECKS.every(({ id }) => checks[id] === 'ok');
}

/** UI rehearsal only: these results do not indicate a physical device or camera connection. */
export function startPracticeCalibration(update: (checks: DeviceChecks) => void): () => void {
  const checks: DeviceChecks = { pairing: 'pending', lights: 'pending', motion: 'pending', camera: 'pending' };
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  function step(index: number) {
    const { id } = SWORD_CHECKS[index]!;
    checks[id] = 'checking';
    update({ ...checks });
    timer = setTimeout(() => {
      if (cancelled) return;
      checks[id] = 'ok';
      if (index + 1 < SWORD_CHECKS.length) step(index + 1);
      else update({ ...checks });
    }, 600);
  }
  step(0);
  return () => { cancelled = true; clearTimeout(timer); };
}
