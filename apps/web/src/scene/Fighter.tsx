import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type MeshStandardMaterial } from 'three';
import type { PlayerSlot } from '../game/types';
import type { PoseStore } from '../hooks/useSwordPoses';
import { ModelSlot } from './ModelSlot';
import { MODELS } from './models';
import { Sword } from './Sword';

const BODY = new Color('#d9d9de');
const HIT = new Color('#ff5a6e');
const FLASH_MS = 450;

interface FighterProps {
  slot: PlayerSlot;
  poses: PoseStore;
  position: [number, number, number];
  facing: number;
  lastHitAt?: number;
  shielded: boolean;
}

export function Fighter({ slot, poses, position, facing, lastHitAt, shielded }: FighterProps) {
  const body = useRef<MeshStandardMaterial>(null);
  const head = useRef<MeshStandardMaterial>(null);

  useFrame(() => {
    const since = lastHitAt === undefined ? Infinity : Date.now() - lastHitAt;
    const k = since < FLASH_MS ? 1 - since / FLASH_MS : 0;
    body.current?.color.lerpColors(BODY, HIT, k);
    head.current?.color.lerpColors(BODY, HIT, k);
  });

  return (
    <group position={position} rotation={[0, facing, 0]}>
      <ModelSlot model={MODELS.fighter}>
        <mesh position={[0, 0.95, 0]}>
          <capsuleGeometry args={[0.32, 0.9, 6, 16]} />
          <meshStandardMaterial ref={body} color={BODY} />
        </mesh>
        <mesh position={[0, 1.85, 0]}>
          <sphereGeometry args={[0.22, 20, 14]} />
          <meshStandardMaterial ref={head} color={BODY} />
        </mesh>
      </ModelSlot>
      {/* Right hand, held in front of the body. */}
      <group position={[0.42, 1.0, 0.32]}>
        <Sword slot={slot} poses={poses} />
      </group>
      {shielded && (
        <mesh position={[0, 1.1, 0]}>
          <sphereGeometry args={[1.15, 32, 20]} />
          <meshStandardMaterial color="#9fd8ff" transparent opacity={0.25} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}
