import { useEffect, useState } from 'react';
import { audioActivity } from '../audio/activity';
import { createMusicPlayer, MUSIC_PREFERENCE, readMusicSettings, type MusicScene, type MusicState } from '../audio/music';
import './MusicControls.css';

/** Stays mounted across page turns and matches; music preferences never change Moss's mute. */
export function MusicControls({ scene }: { scene: MusicScene }) {
  const [player, setPlayer] = useState<ReturnType<typeof createMusicPlayer> | null>(null);
  const [state, setState] = useState<MusicState>({ volume: 0.3, muted: false, status: 'idle' });
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(MUSIC_PREFERENCE); } catch { /* Music also works without storage. */ }
    const music = createMusicPlayer({
      makeAudio: src => new Audio(src), settings: readMusicSettings(saved),
      save: settings => { try { localStorage.setItem(MUSIC_PREFERENCE, JSON.stringify(settings)); } catch { /* Optional. */ } },
    });
    setPlayer(music); setState(music.snapshot());
    const unsubscribe = music.subscribe(() => setState(music.snapshot()));
    const activity = () => music.setActivity(audioActivity.snapshot());
    const stopActivity = audioActivity.subscribe(activity); activity();
    const visibility = () => music.setHidden(document.hidden); visibility();
    const unlock = () => music.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      unsubscribe(); stopActivity(); music.dispose();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => { player?.setScene(scene); }, [player, scene]);
  if (!scene) return null;
  const silent = state.muted || state.volume === 0;
  const needsRetry = state.status === 'blocked' || state.status === 'error';
  return <div className="music-controls" role="group" aria-label="Background music">
    <button type="button" className="music-toggle" aria-label={silent ? 'Unmute music' : 'Mute music'}
      aria-pressed={silent} title={silent ? 'Unmute music' : 'Mute music'} disabled={!player}
      onClick={() => { player?.setMuted(!silent); if (silent) player?.retry(); }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 9h4l5-4v14l-5-4H4V9Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        {silent ? <path d="m17 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" />
          : <path d="M17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
      </svg>
      <span>Music</span>
    </button>
    <label className="music-volume">
      <span className="sr-only">Music volume</span>
      <input type="range" min="0" max="100" step="1" value={Math.round(state.volume * 100)}
        disabled={!player} aria-valuetext={`${Math.round(state.volume * 100)} percent`}
        onChange={event => player?.setVolume(Number(event.target.value) / 100)} />
    </label>
    <output className="music-percent" aria-hidden="true">{silent ? 'Off' : `${Math.round(state.volume * 100)}%`}</output>
    {needsRetry && !silent && <button type="button" className="music-retry" onClick={() => player?.retry()}>
      {state.status === 'blocked' ? 'Enable music' : 'Retry music'}
    </button>}
    <span className="sr-only" role="status">{state.status === 'error' ? 'Music could not play. You can retry.'
      : state.status === 'blocked' ? 'Select Enable music to allow playback.' : ''}</span>
  </div>;
}
