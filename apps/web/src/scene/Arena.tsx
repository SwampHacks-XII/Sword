import { Canvas } from '@react-three/fiber';
import { otherSlot, type PlayerSlot } from '../game/types';
import type { PoseStore } from '../hooks/useSwordPoses';
import { Fighter } from './Fighter';

const SKY = '#b9b3e3';

export interface ArenaProps {
  you: PlayerSlot;
  poses: PoseStore;
  lastHitAt: Partial<Record<PlayerSlot, number>>;
  shielded: Partial<Record<PlayerSlot, boolean>>;
}

/** Background 3D scene: your fighter in front (over-the-shoulder view), the opponent across the field. */
export function Arena({ you, poses, lastHitAt, shielded }: ArenaProps) {
  const opponent = otherSlot(you);
  return (
    <Canvas
      className="arena"
      // Render at a fraction of screen resolution; CSS scales it up with hard pixel edges.
      dpr={0.3}
      camera={{ position: [1.2, 2.3, 7], fov: 50 }}
      gl={{ alpha: true, antialias: false }}
      onCreated={({ camera }) => camera.lookAt(0, 1.3, -1)}
    >
      <fog attach="fog" args={[SKY, 16, 42]} />
      <hemisphereLight args={['#fff4ff', '#7da35a', 1.2]} />
      <directionalLight position={[4, 8, 5]} intensity={1.4} />

      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[120, 120]} />
        <shadowMaterial transparent opacity={0.12} />
      </mesh>

      <Fighter
        slot={you} poses={poses} position={[-0.9, 0, 3]} facing={Math.PI}
        lastHitAt={lastHitAt[you]} shielded={!!shielded[you]}
      />
      <Fighter
        slot={opponent} poses={poses} position={[0.6, 0, -3]} facing={0}
        lastHitAt={lastHitAt[opponent]} shielded={!!shielded[opponent]}
      />
    </Canvas>
  );
}
