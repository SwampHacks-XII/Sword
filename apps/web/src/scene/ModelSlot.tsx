import { Component, Suspense, useMemo, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import type { ModelEntry } from './models';

/** Shows the model when one is configured, otherwise (or while loading / on error) the placeholder children. */
export function ModelSlot({ model, children }: { model: ModelEntry | null; children: ReactNode }) {
  if (!model) return <>{children}</>;
  return (
    <ModelErrorBoundary fallback={children} url={model.url}>
      <Suspense fallback={children}>
        <GltfModel url={model.url} scale={model.scale ?? 1} />
      </Suspense>
    </ModelErrorBoundary>
  );
}

function GltfModel({ url, scale }: { url: string; scale: number }) {
  const { scene } = useGLTF(url);
  // Clone so both fighters can use the same model file.
  const copy = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={copy} scale={scale} />;
}

class ModelErrorBoundary extends Component<{ fallback: ReactNode; url: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    console.warn(`Could not load model ${this.props.url}; showing the placeholder.`);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
