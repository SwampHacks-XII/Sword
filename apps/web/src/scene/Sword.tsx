import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Quaternion, type Group } from 'three';
import type { PlayerSlot } from '../game/types';
import type { PoseStore } from '../hooks/useSwordPoses';
import { ModelSlot } from './ModelSlot';
import { MODELS } from './models';

const GRIP_DOTS = ['#e0607e', '#6d9be0', '#6cc489', '#e8c75a'];
// Each player's blade ends in their own glowing tip.
const TIP_COLORS: Record<PlayerSlot, string> = { p1: '#a35cff', p2: '#ff5fb0' };
const target = new Quaternion();

/**
 * One sword, pivoting at the grip. Identity orientation = blade straight up.
 * Sensor axes may need remapping here once the real MPU6050 mounting is known.
 */
export function Sword({ slot, poses, pivotRef }: { slot: PlayerSlot; poses: PoseStore; pivotRef?: RefObject<Group | null> }) {
  const own = useRef<Group>(null);
  // The fighter can pass its own ref so the arms follow the smoothed sword orientation.
  const ref = pivotRef ?? own;

  useFrame((_, delta) => {
    if (!ref.current) return;
    const [w, x, y, z] = poses[slot];
    target.set(x, y, z, w);
    // Smooth toward the latest reading instead of snapping on every packet.
    ref.current.quaternion.slerp(target, 1 - Math.exp(-delta * 15));
  });

  return (
    <group ref={ref}>
      <ModelSlot model={MODELS.sword}>
        <SwordPlaceholder tip={TIP_COLORS[slot]} />
      </ModelSlot>
    </group>
  );
}

function SwordPlaceholder({ tip }: { tip: string }) {
  return (
    <group>
      <mesh>
        <boxGeometry args={[0.09, 0.32, 0.07]} />
        <meshStandardMaterial color="#5d4d73" />
      </mesh>
      {GRIP_DOTS.map((color, i) => (
        <mesh key={color} position={[0, 0.1 - i * 0.065, 0.04]}>
          <sphereGeometry args={[0.022, 12, 8]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
        </mesh>
      ))}
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[0.42, 0.07, 0.1]} />
        <meshStandardMaterial color="#5d4d73" />
      </mesh>
      <mesh position={[0, 0.98, 0]}>
        <boxGeometry args={[0.14, 1.5, 0.05]} />
        <meshStandardMaterial color="#8f7fb0" />
      </mesh>
      <mesh position={[0, 0.95, 0]}>
        <boxGeometry args={[0.025, 1.3, 0.052]} />
        <meshStandardMaterial color="#d9a3a8" />
      </mesh>
      {/* Pointed tip on top of the blade (which ends at y 1.73), flattened to the blade's thickness. */}
      <group position={[0, 1.87, 0]} scale={[1, 1, 0.36]}>
        <mesh rotation={[0, Math.PI / 4, 0]}>
          <coneGeometry args={[0.1, 0.28, 4]} />
          <meshStandardMaterial color={tip} emissive={tip} emissiveIntensity={0.6} />
        </mesh>
      </group>
    </group>
  );
}
