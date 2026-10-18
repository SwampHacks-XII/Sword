import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Outlines } from '@react-three/drei';
import { Color, MeshStandardMaterial, Quaternion, Vector3, type Group, type Mesh } from 'three';
import type { PlayerSlot } from '../game/types';
import type { PoseStore } from '../hooks/useSwordPoses';
import { ModelSlot } from './ModelSlot';
import { MODELS } from './models';
import { Sword } from './Sword';

// Colours from the 2D hero sprite (knight-idle.png): pale blue-white skin, lavender shading, black outline.
const SKIN = new Color('#d0dbe3');
const SHADE = new Color('#d2c3db');
const INK = '#1a1a1a';
const HIT = new Color('#ff5a6e');
const FLASH_MS = 450;
const OUTLINE = 0.035;

// Body layout in fighter space (+z faces the opponent).
const HEAD = new Vector3(0, 1.62, 0);
const HEAD_RADIUS = 0.42;
const TORSO_RADIUS = 0.27;
const ARM_RADIUS = 0.08;
// The sword grip swings around the chest: with the blade straight up it sits in front of the right hip.
const CHEST = new Vector3(0, 1.15, 0);
const REACH = new Vector3(0.42, -0.15, 0.32);
// Each arm: its shoulder, where its hand holds the handle in the sword's own frame (right hand by the guard,
// left below it), and which way its elbow bends (outward, down and a little back, away from the body).
const ARMS = [
  { shoulder: new Vector3(0.3, 1.25, 0.02), handle: new Vector3(0, 0.08, 0), bend: new Vector3(0.16, -0.1, -0.04) },
  { shoulder: new Vector3(-0.3, 1.25, 0.02), handle: new Vector3(0, -0.08, 0), bend: new Vector3(-0.16, -0.1, -0.04) },
];

/** Moves a point out of the torso and head so hands and elbows never sink into the body. */
function keepOutsideBody(point: Vector3) {
  const clear = TORSO_RADIUS + ARM_RADIUS + 0.04;
  const r = Math.hypot(point.x, point.z);
  if (point.y > 0.4 && point.y < 1.5 && r < clear) {
    if (r < 1e-4) point.z = clear;
    else { point.x *= clear / r; point.z *= clear / r; }
  }
  const fromHead = point.clone().sub(HEAD);
  const headClear = HEAD_RADIUS + ARM_RADIUS + 0.04;
  if (fromHead.length() < headClear) point.copy(HEAD).addScaledVector(fromHead.normalize(), headClear);
  return point;
}

/** Where the grip sits for a given sword orientation: swung around the chest, kept in front of and outside the body. */
function gripFor(orientation: Quaternion, out: Vector3) {
  out.copy(REACH).applyQuaternion(orientation).add(CHEST);
  out.z = Math.max(out.z, 0.25);
  return keepOutsideBody(out);
}

interface FighterProps {
  slot: PlayerSlot;
  poses: PoseStore;
  position: [number, number, number];
  facing: number;
  lastHitAt?: number;
  shielded: boolean;
  /** Blade tip colour of the physical sword this player holds, if known. */
  swordTip?: string;
}

export function Fighter({ slot, poses, position, facing, lastHitAt, shielded, swordTip }: FighterProps) {
  // One material per fighter for each tone, so every body part flashes together when hit.
  const skin = useMemo(() => new MeshStandardMaterial({ color: SKIN, flatShading: true }), []);
  const shade = useMemo(() => new MeshStandardMaterial({ color: SHADE, flatShading: true }), []);
  const grip = useRef<Group>(null);
  const sword = useRef<Group>(null);

  useFrame(() => {
    const since = lastHitAt === undefined ? Infinity : Date.now() - lastHitAt;
    const k = since < FLASH_MS ? 1 - since / FLASH_MS : 0;
    skin.color.lerpColors(SKIN, HIT, k);
    shade.color.lerpColors(SHADE, HIT, k);
    if (grip.current && sword.current) gripFor(sword.current.quaternion, grip.current.position);
  });

  return (
    <group position={position} rotation={[0, facing, 0]}>
      <ModelSlot model={MODELS.fighter}>
        <KnightFigure skin={skin} shade={shade} sword={sword} />
      </ModelSlot>
      <group ref={grip} position={REACH.clone().add(CHEST)}>
        <Sword slot={slot} poses={poses} pivotRef={sword} tip={swordTip} />
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

/** The chibi hero from the 2D sprite: big round head, small body, both hands on the sword. */
function KnightFigure({ skin, shade, sword }: { skin: MeshStandardMaterial; shade: MeshStandardMaterial; sword: RefObject<Group | null> }) {
  return (
    <group>
      <mesh position={HEAD} material={skin}>
        <sphereGeometry args={[HEAD_RADIUS, 16, 12]} />
        <Outlines thickness={OUTLINE} color={INK} />
      </mesh>
      {/* Eyes tilted inward for the sprite's determined frown, plus a small mouth. */}
      {[-1, 1].map(side => (
        <mesh key={side} position={[side * 0.13, 1.64, 0.39]} rotation={[0, 0, side * 0.35]}>
          <boxGeometry args={[0.09, 0.05, 0.05]} />
          <meshBasicMaterial color={INK} />
        </mesh>
      ))}
      <mesh position={[0, 1.47, 0.38]}>
        <boxGeometry args={[0.1, 0.03, 0.05]} />
        <meshBasicMaterial color={INK} />
      </mesh>

      <mesh position={[0, 0.98, 0]} material={skin}>
        <capsuleGeometry args={[TORSO_RADIUS, 0.35, 4, 10]} />
        <Outlines thickness={OUTLINE} color={INK} />
      </mesh>
      {[-0.13, 0.13].map(x => (
        <mesh key={x} position={[x, 0.35, 0]} material={shade}>
          <capsuleGeometry args={[0.1, 0.54, 4, 8]} />
          <Outlines thickness={OUTLINE} color={INK} />
        </mesh>
      ))}
      <Arms skin={skin} sword={sword} />
    </group>
  );
}

const UP = new Vector3(0, 1, 0);
const hand = new Vector3();
const elbow = new Vector3();
const gripAt = new Vector3();
const dir = new Vector3();

/** Stretches a unit-height cylinder between two points. */
function placeSegment(mesh: Mesh, a: Vector3, b: Vector3) {
  dir.copy(b).sub(a);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.scale.set(1, Math.max(dir.length(), 1e-3), 1);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
}

/** Two arms, each bending at the elbow, with both hands following the sword's handle. */
function Arms({ skin, sword }: { skin: MeshStandardMaterial; sword: RefObject<Group | null> }) {
  // Per arm: upper arm, forearm, elbow joint, hand.
  const parts = useRef<(Mesh | null)[]>([]);

  useFrame(() => {
    const orientation = sword.current?.quaternion;
    if (!orientation) return;
    gripFor(orientation, gripAt);
    ARMS.forEach(({ shoulder, handle, bend }, i) => {
      const [upper, fore, joint, fist] = parts.current.slice(i * 4, i * 4 + 4);
      if (!upper || !fore || !joint || !fist) return;
      keepOutsideBody(hand.copy(handle).applyQuaternion(orientation).add(gripAt));
      keepOutsideBody(elbow.copy(shoulder).add(hand).multiplyScalar(0.5).add(bend));
      placeSegment(upper, shoulder, elbow);
      placeSegment(fore, elbow, hand);
      joint.position.copy(elbow);
      fist.position.copy(hand);
    });
  });

  return <>
    {ARMS.map(({ shoulder }, i) => <group key={i}>
      <mesh position={shoulder} material={skin}><sphereGeometry args={[ARM_RADIUS, 8, 6]} /></mesh>
      {[0, 1].map(segment => (
        <mesh key={segment} ref={mesh => { parts.current[i * 4 + segment] = mesh; }} material={skin}>
          <cylinderGeometry args={[ARM_RADIUS, ARM_RADIUS, 1, 8]} />
          <Outlines thickness={OUTLINE} color={INK} />
        </mesh>
      ))}
      <mesh ref={mesh => { parts.current[i * 4 + 2] = mesh; }} material={skin}><sphereGeometry args={[ARM_RADIUS, 8, 6]} /></mesh>
      <mesh ref={mesh => { parts.current[i * 4 + 3] = mesh; }} material={skin}>
        <sphereGeometry args={[0.09, 8, 6]} />
        <Outlines thickness={OUTLINE} color={INK} />
      </mesh>
    </group>)}
  </>;
}
