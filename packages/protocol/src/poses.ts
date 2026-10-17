import type { Gesture, PlayerSlot, Quat } from './types.js';

/** Keyboard practice animation; these are not physical sensor measurements. */
export function createPoseSimulator() {
  const active: Partial<Record<PlayerSlot, { gesture: Gesture; start: number }>> = {};
  return {
    play(slot: PlayerSlot, gesture: Gesture, now: number) { active[slot] = { gesture, start: now }; },
    sample(slot: PlayerSlot, now: number): Quat {
      const offset = slot === 'p1' ? 0 : 1.7;
      const t = now / 1000;
      let pitch = 0.08 * Math.sin(t * 1.3 + offset);
      let yaw = 0.05 * Math.sin(t * 0.7 + offset);
      let roll = 0.06 * Math.sin(t * 0.9 + offset);
      const anim = active[slot];
      if (anim) {
        const progress = (now - anim.start) / 450;
        if (progress >= 1) delete active[slot];
        else {
          const k = Math.sin(Math.PI * progress);
          if (anim.gesture === 'swing_right') roll -= 1.2 * k;
          else if (anim.gesture === 'swing_left') roll += 1.2 * k;
          else if (anim.gesture === 'wrist_rotate') yaw += 2 * Math.PI * progress;
          else { pitch *= 1 - k; roll *= 1 - k; }
        }
      }
      const c1 = Math.cos(pitch / 2), c2 = Math.cos(yaw / 2), c3 = Math.cos(roll / 2);
      const s1 = Math.sin(pitch / 2), s2 = Math.sin(yaw / 2), s3 = Math.sin(roll / 2);
      return [c1 * c2 * c3 - s1 * s2 * s3, s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3];
    },
  };
}
