export type MusicScene = 'lobby' | 'battle' | null;
export interface MusicSettings { volume: number; muted: boolean }
export interface MusicState extends MusicSettings { status: 'idle' | 'playing' | 'blocked' | 'error' }
export interface MusicAudio {
  volume: number; muted: boolean; loop: boolean; preload: string; currentTime: number;
  play(): Promise<void>; pause(): void;
  addEventListener(type: 'error', listener: () => void): void;
  removeEventListener(type: 'error', listener: () => void): void;
}
const DEFAULT_VOLUME = 0.3;
export const MUSIC_PREFERENCE = 'sword.music';

export function readMusicSettings(value: string | null): MusicSettings {
  try {
    const saved = JSON.parse(value ?? 'null') as Partial<MusicSettings> | null;
    return {
      volume: typeof saved?.volume === 'number' && Number.isFinite(saved.volume)
        ? Math.max(0, Math.min(1, saved.volume)) : DEFAULT_VOLUME,
      muted: saved?.muted === true,
    };
  } catch { return { volume: DEFAULT_VOLUME, muted: false }; }
}

/** One pair of looping audio elements, shared across lobby, quest, battle and rematch. */
export function createMusicPlayer(options: {
  makeAudio(src: string): MusicAudio;
  settings: MusicSettings;
  save(settings: MusicSettings): void;
  every?(callback: () => void): () => void;
}) {
  type Track = { audio: MusicAudio; running: boolean; version: number; error: () => void };
  const tracks = new Map<Exclude<MusicScene, null>, Track>();
  const listeners = new Set<() => void>();
  let state: MusicState = { ...options.settings, status: 'idle' };
  let scene: MusicScene = null;
  let unlocked = false;
  let listening = false;
  let speaking = false;
  let hidden = false;
  let disposed = false;
  let stopRamp: (() => void) | undefined;
  const every = options.every ?? (callback => {
    const timer = setInterval(callback, 30);
    return () => clearInterval(timer);
  });
  function publish(next: Partial<MusicState>) {
    if (disposed) return;
    const updated = { ...state, ...next };
    if (updated.status === state.status && updated.volume === state.volume && updated.muted === state.muted) return;
    state = updated;
    listeners.forEach(listener => listener());
  }
  function pause(track: Track, reset = false) {
    track.version++;
    track.audio.pause(); track.running = false;
    if (reset) track.audio.currentTime = 0;
  }
  function trackFor(key: Exclude<MusicScene, null>) {
    const existing = tracks.get(key);
    if (existing) return existing;
    const audio = options.makeAudio(`/audio/${key}.mp3`);
    audio.loop = true; audio.preload = 'none'; audio.volume = 0; audio.muted = state.muted;
    const track: Track = { audio, running: false, version: 0, error: () => {
      if (disposed || scene !== key) return;
      pause(track); publish({ status: 'error' });
    } };
    audio.addEventListener('error', track.error);
    tracks.set(key, track);
    return track;
  }
  function start(key: Exclude<MusicScene, null>, track: Track) {
    if (track.running) return;
    track.running = true;
    const version = ++track.version;
    void track.audio.play().then(() => {
      if (disposed || version !== track.version || scene !== key) return;
      publish({ status: 'playing' });
    }).catch((error: unknown) => {
      if (disposed || version !== track.version || scene !== key) return;
      track.running = false; track.audio.volume = 0;
      publish({ status: error && typeof error === 'object' && 'name' in error && error.name === 'NotAllowedError'
        ? 'blocked' : 'error' });
    });
  }
  function ramp() {
    if (stopRamp) return;
    stopRamp = every(() => {
      let changing = false;
      for (const [key, track] of tracks) {
        const target = key === scene && track.running ? state.volume * (speaking ? 0.2 : 1) : 0;
        const difference = target - track.audio.volume;
        // About half a second for a full-volume transition; settings remain independent of ducking.
        track.audio.volume = Math.abs(difference) <= 0.06 ? target
          : Math.max(0, Math.min(1, track.audio.volume + Math.sign(difference) * 0.06));
        if (track.audio.volume !== target) changing = true;
        if (key !== scene && track.audio.volume === 0 && track.running) pause(track, true);
      }
      if (!changing) { stopRamp?.(); stopRamp = undefined; }
    });
  }
  function reconcile(retry = false) {
    if (disposed) return;
    if (!scene || listening || hidden || !unlocked) {
      stopRamp?.(); stopRamp = undefined;
      for (const [key, track] of tracks) {
        track.audio.volume = 0;
        if (track.running) pause(track, !scene || key !== scene);
      }
      publish({ status: 'idle' });
      return;
    }
    for (const track of tracks.values()) track.audio.muted = state.muted;
    const track = trackFor(scene);
    if (retry || (state.status !== 'blocked' && state.status !== 'error')) start(scene, track);
    ramp();
  }
  function save() { options.save({ volume: state.volume, muted: state.muted }); }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setScene(value: MusicScene) {
      if (scene === value) return;
      scene = value; publish({ status: 'idle' }); reconcile();
    },
    /** Call in a trusted click/key handler; a blocked play can be retried explicitly. */
    unlock() { if (unlocked) return; unlocked = true; reconcile(true); },
    retry() { unlocked = true; publish({ status: 'idle' }); reconcile(true); },
    setVolume(value: number) {
      if (!Number.isFinite(value)) return;
      publish({ volume: Math.max(0, Math.min(1, value)), ...(value > 0 ? { muted: false } : {}) });
      save(); reconcile();
    },
    setMuted(value: boolean) {
      publish({ muted: value, ...(!value && state.volume === 0 ? { volume: DEFAULT_VOLUME } : {}) });
      save(); reconcile();
    },
    setActivity(value: { speaking: boolean; listening: boolean }) {
      speaking = value.speaking; listening = value.listening; reconcile();
    },
    setHidden(value: boolean) { hidden = value; reconcile(); },
    dispose() {
      disposed = true; stopRamp?.(); stopRamp = undefined;
      for (const track of tracks.values()) { pause(track); track.audio.removeEventListener('error', track.error); }
      tracks.clear(); listeners.clear();
    },
  };
}
