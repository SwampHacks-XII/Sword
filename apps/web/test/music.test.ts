import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAudioActivity } from '../src/audio/activity';
import { createMusicPlayer, readMusicSettings, type MusicAudio, type MusicSettings } from '../src/audio/music';

class TestAudio implements MusicAudio {
  volume = 1; muted = false; loop = false; preload = ''; currentTime = 0;
  plays = 0; pauses = 0;
  onPlay: () => Promise<void> = async () => {};
  errors = new Set<() => void>();
  play() { this.plays++; return this.onPlay(); }
  pause() { this.pauses++; }
  addEventListener(_type: 'error', listener: () => void) { this.errors.add(listener); }
  removeEventListener(_type: 'error', listener: () => void) { this.errors.delete(listener); }
}
function fixture(settings: MusicSettings = { volume: 0.3, muted: false }) {
  const audio = new Map<string, TestAudio>();
  const saved: MusicSettings[] = [];
  let tick: (() => void) | undefined;
  const player = createMusicPlayer({ settings, save: value => saved.push(value),
    makeAudio: src => { const element = new TestAudio(); audio.set(src, element); return element; },
    every: callback => { tick = callback; return () => { tick = undefined; }; },
  });
  return { player, audio, saved, fade: () => { for (let i = 0; i < 30; i++) tick?.(); } };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test('music waits for interaction, loops both supplied tracks, fades between scenes and returns to lobby on rematch', async () => {
  const f = fixture();
  f.player.setScene('lobby'); assert.equal(f.audio.size, 0);
  f.player.unlock(); await settle(); f.fade();
  const lobby = f.audio.get('/audio/lobby.mp3')!;
  assert.equal(lobby.loop, true); assert.equal(lobby.volume, 0.3);
  assert.equal(lobby.plays, 1); assert.equal(f.player.snapshot().status, 'playing');
  lobby.currentTime = 48;
  f.player.setScene('battle'); await settle();
  const battle = f.audio.get('/audio/battle.mp3')!;
  assert.equal(battle.loop, true); assert.equal(battle.volume, 0);
  f.fade(); assert.equal(lobby.volume, 0); assert.equal(lobby.pauses, 1);
  assert.equal(lobby.currentTime, 0); assert.equal(battle.volume, 0.3);
  f.player.setScene('lobby'); await settle(); f.fade();
  assert.equal(lobby.plays, 2); assert.equal(battle.pauses, 1);
  assert.equal(f.audio.size, 2, 'rematches reuse the existing players');
  f.player.setScene(null); assert.equal(lobby.volume, 0); assert.equal(lobby.pauses, 2);
  f.player.dispose();
});

test('music ducks for speech, pauses for the microphone and resumes at the same playhead', async () => {
  const f = fixture(); f.player.setScene('lobby'); f.player.unlock(); await settle(); f.fade();
  const audio = f.audio.get('/audio/lobby.mp3')!;
  audio.currentTime = 22;
  f.player.setActivity({ speaking: true, listening: false }); f.fade();
  assert.equal(audio.volume, 0.06); assert.equal(f.player.snapshot().volume, 0.3);
  f.player.setActivity({ speaking: true, listening: true });
  assert.equal(audio.volume, 0); assert.equal(audio.pauses, 1);
  assert.equal(audio.currentTime, 22);
  f.player.setActivity({ speaking: true, listening: false }); await settle(); f.fade();
  assert.equal(audio.plays, 2); assert.equal(audio.currentTime, 22); assert.equal(audio.volume, 0.06);
  f.player.setActivity({ speaking: false, listening: false }); f.fade();
  assert.equal(audio.volume, 0.3); assert.deepEqual(f.saved, [], 'ducking never overwrites the volume preference');
  f.player.dispose();
});

test('music mute preserves playback, slider changes persist, and unmute works after volume zero', async () => {
  const f = fixture(); f.player.setScene('battle'); f.player.unlock(); await settle(); f.fade();
  const audio = f.audio.get('/audio/battle.mp3')!; audio.currentTime = 12;
  f.player.setMuted(true);
  assert.equal(audio.muted, true); assert.equal(audio.pauses, 0); assert.equal(audio.currentTime, 12);
  f.player.setVolume(0.6); f.fade();
  assert.equal(audio.muted, false); assert.equal(audio.volume, 0.6);
  f.player.setVolume(0); f.fade(); assert.equal(audio.volume, 0);
  f.player.setMuted(false); f.fade(); assert.equal(audio.volume, 0.3);
  assert.deepEqual(f.saved.at(-1), { muted: false, volume: 0.3 });
  f.player.setVolume(Number.NaN); assert.equal(f.player.snapshot().volume, 0.3);
  f.player.dispose();
});

test('saved music settings survive reload and malformed preferences fall back safely', () => {
  assert.deepEqual(readMusicSettings('{bad json'), { volume: 0.3, muted: false });
  assert.deepEqual(readMusicSettings(null), { volume: 0.3, muted: false });
  assert.deepEqual(readMusicSettings('{"volume":-2,"muted":true}'), { volume: 0, muted: true });
  assert.deepEqual(readMusicSettings('{"volume":5}'), { volume: 1, muted: false });
  const f = fixture(readMusicSettings('{"volume":0.42,"muted":true}'));
  f.player.setScene('lobby'); f.player.unlock(); f.fade();
  assert.equal(f.audio.get('/audio/lobby.mp3')!.muted, true);
  assert.equal(f.audio.get('/audio/lobby.mp3')!.volume, 0.42);
  f.player.dispose();
});

test('autoplay denial offers explicit retry, and old rejection cannot overwrite the next scene', async () => {
  const f = fixture(); f.player.setScene('lobby'); f.player.unlock(); await settle();
  const lobby = f.audio.get('/audio/lobby.mp3')!;
  f.player.setHidden(true);
  lobby.onPlay = async () => { throw Object.assign(new Error('Interaction needed'), { name: 'NotAllowedError' }); };
  f.player.setHidden(false); await settle();
  assert.equal(f.player.snapshot().status, 'blocked');
  lobby.onPlay = async () => {};
  f.player.retry(); await settle(); f.fade();
  assert.equal(f.player.snapshot().status, 'playing'); assert.equal(lobby.volume, 0.3);
  let reject!: (reason: Error) => void;
  lobby.onPlay = () => new Promise((_resolve, fail) => { reject = fail; });
  f.player.setHidden(true); f.player.setHidden(false);
  f.player.setScene('battle'); await settle(); f.fade();
  reject(new Error('Old request')); await settle();
  assert.equal(f.player.snapshot().status, 'playing');
  assert.equal(f.audio.get('/audio/battle.mp3')!.volume, 0.3);
  f.player.dispose();
});

test('leaving during a pending play cancels it and hidden tabs pause without losing position', async () => {
  const f = fixture(); f.player.setScene('lobby'); f.player.unlock(); await settle(); f.fade();
  const audio = f.audio.get('/audio/lobby.mp3')!; audio.currentTime = 9;
  f.player.setHidden(true); assert.equal(audio.pauses, 1); assert.equal(audio.currentTime, 9);
  let finish!: () => void;
  audio.onPlay = () => new Promise(resolve => { finish = resolve; });
  f.player.setHidden(false); f.player.setScene(null);
  finish(); await settle();
  assert.equal(f.player.snapshot().status, 'idle'); assert.equal(audio.volume, 0); assert.equal(audio.currentTime, 0);
  f.player.dispose(); assert.equal(audio.errors.size, 0);
});

test('failed audio can be retried and cleanup ignores pending promises and errors', async () => {
  const f = fixture(); f.player.setScene('battle'); f.player.unlock(); await settle(); f.fade();
  const audio = f.audio.get('/audio/battle.mp3')!;
  audio.errors.forEach(listener => listener());
  assert.equal(f.player.snapshot().status, 'error');
  f.player.retry(); await settle(); f.fade(); assert.equal(f.player.snapshot().status, 'playing');
  f.player.dispose(); assert.equal(audio.errors.size, 0); assert.equal(audio.volume, 0.3);
  assert.ok(audio.pauses >= 2);
});

test('multiple Moss speakers and microphone owners release independently, including unmount cleanup', () => {
  const activity = createAudioActivity(); const first = Symbol(); const second = Symbol(); const mic = Symbol();
  let notifications = 0; const stop = activity.subscribe(() => notifications++);
  activity.set(first, 'speech', true); activity.set(second, 'speech', true);
  activity.set(first, 'speech', false);
  assert.deepEqual(activity.snapshot(), { speaking: true, listening: false });
  activity.set(mic, 'microphone', true); activity.set(second, 'speech', false);
  assert.deepEqual(activity.snapshot(), { speaking: false, listening: true });
  activity.set(mic, 'microphone', false);
  assert.deepEqual(activity.snapshot(), { speaking: false, listening: false });
  assert.equal(notifications, 4); stop();
});
