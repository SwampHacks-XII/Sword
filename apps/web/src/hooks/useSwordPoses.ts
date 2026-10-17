import type { PlayerSlot, Quat } from '../game/types';
import { useConnection } from './useConnection';

/**
 * Latest sword orientation per player. Plain mutable object, deliberately NOT React state:
 * poses arrive ~30 times a second and are read inside useFrame without re-rendering React.
 */
export type PoseStore = Record<PlayerSlot, Quat>;

export function createPoseStore(): PoseStore {
  return { p1: [1, 0, 0, 0], p2: [1, 0, 0, 0] };
}

export function useSwordPoses(): PoseStore {
  return useConnection().poses;
}
