// Real 3D models go in apps/web/public/models (prefer .glb).
// Set a path here once the file exists, e.g. sword: { url: '/models/sword.glb', scale: 1 }.
// Leave as null to keep the flat placeholder.
export interface ModelEntry { url: string; scale?: number }

export const MODELS: { fighter: ModelEntry | null; sword: ModelEntry | null } = {
  fighter: null,
  sword: null,
};
