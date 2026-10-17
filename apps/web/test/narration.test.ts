import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNarrator, type NarrationState } from '../src/story/narration';
import { MOSS_REACTIONS, mossReaction } from '../src/story/reactions';
import { createMossNarrator } from '../src/story/elevenLabsNarration';
import { loadMossAudio } from '../src/net/voice';
import { MOSS_PROLOGUE, MOSS_CHEER, MOSS_ENDINGS, FALLBACK_BRIEFINGS } from '@sword/protocol';

test('browser narration uses an English device voice, replaces old speech, and stops cleanly', () => {
  const states: NarrationState[] = [];
  const spoken: SpeechSynthesisUtterance[] = [];
  let cancelled = 0;
  const localVoice = { lang: 'en-US', localService: true } as SpeechSynthesisVoice;
  const synth = { getVoices: () => [{ lang: 'fr-FR', localService: true }, localVoice], cancel: () => { cancelled++; },
    speak: (utterance: SpeechSynthesisUtterance) => { spoken.push(utterance); } } as unknown as SpeechSynthesis;
  const narrator = createNarrator(synth, text => ({ text }) as SpeechSynthesisUtterance, state => states.push(state));
  narrator.speak('Your evil twin stole the chickens!');
  assert.equal(spoken[0]!.text, 'Your evil twin stole the chickens!');
  assert.equal(spoken[0]!.voice, localVoice); assert.equal(states.at(-1), 'speaking');
  assert.equal(spoken[0]!.pitch, 1.48);
  assert.equal(spoken[0]!.rate, 1.16);
  const oldEnd = spoken[0]!.onend;
  narrator.speak('Good hit!');
  assert.equal(cancelled, 1); assert.equal(spoken.length, 2);
  oldEnd?.call(spoken[0]!, {} as SpeechSynthesisEvent);
  assert.equal(states.at(-1), 'speaking');
  spoken[1]!.onend?.call(spoken[1]!, {} as SpeechSynthesisEvent);
  assert.equal(states.at(-1), 'idle');
  narrator.speak('Moss is cheering!'); narrator.stop();
  assert.equal(cancelled, 2); assert.equal(states.at(-1), 'idle');
});

function audioFixture(load: (text: string, signal: AbortSignal) => Promise<Blob>, rejectPlay: boolean | Error = false) {
  const states: NarrationState[] = [];
  const browserWords: string[] = [];
  const elements: HTMLAudioElement[] = [];
  const revoked: string[] = [];
  let played = 0; let paused = 0;
  const synth = { getVoices: () => [], cancel() {}, speak: (utterance: SpeechSynthesisUtterance) => browserWords.push(utterance.text) } as unknown as SpeechSynthesis;
  const narrator = createMossNarrator(synth, text => ({ text }) as SpeechSynthesisUtterance, state => states.push(state), {
    load, timeoutMs: 20, createUrl: () => 'blob:test-voice', revokeUrl: url => revoked.push(url),
    makeAudio: () => {
      const element = { play: async () => { played++; if (rejectPlay) throw rejectPlay instanceof Error ? rejectPlay : new Error('Playback failed'); },
        pause: () => { paused++; }, removeAttribute() {} } as unknown as HTMLAudioElement;
      elements.push(element); return element;
    },
  });
  return { narrator, states, browserWords, elements, revoked, played: () => played, paused: () => paused };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 1));

test('ElevenLabs audio is primary, finishes cleanly and releases its object URL', async () => {
  const f = audioFixture(async () => new Blob(['MP3'], { type: 'audio/mpeg' }));
  f.narrator.speak('Hello, adventurer!'); await settle();
  assert.equal(f.played(), 1); assert.deepEqual(f.browserWords, []); assert.equal(f.states.at(-1), 'speaking');
  assert.equal(f.elements[0]!.playbackRate, 1.15);
  assert.equal(f.elements[0]!.preservesPitch, true);
  f.elements[0]!.onended?.call(f.elements[0]!, new Event('ended'));
  assert.equal(f.states.at(-1), 'idle'); assert.deepEqual(f.revoked, ['blob:test-voice']);
  f.narrator.stop();
});

test('mute and unmute leave the ElevenLabs playhead running and never replay a completed line', async () => {
  const f = audioFixture(async () => new Blob(['MP3']));
  f.narrator.speak('Moss keeps talking'); await settle();
  const audio = f.elements[0]!;
  audio.currentTime = 3;
  f.narrator.setMuted(true);
  assert.equal(audio.muted, true); assert.equal(audio.currentTime, 3);
  audio.currentTime = 7;
  f.narrator.setMuted(false);
  assert.equal(audio.muted, false); assert.equal(audio.currentTime, 7);
  assert.equal(f.played(), 1); assert.equal(f.paused(), 0);
  assert.equal(f.states.at(-1), 'speaking');
  audio.onended?.call(audio, new Event('ended'));
  f.narrator.setMuted(true); f.narrator.setMuted(false);
  assert.equal(f.played(), 1); assert.equal(f.states.at(-1), 'idle');
  f.narrator.stop();
});

test('mute applies to audio still loading and carries into the following page', async () => {
  let finish!: (value: Blob) => void;
  const f = audioFixture(() => new Promise(resolve => { finish = resolve; }));
  f.narrator.speak('First page'); await settle();
  f.narrator.setMuted(true);
  finish(new Blob(['MP3'])); await settle();
  assert.equal(f.elements[0]!.muted, true); assert.equal(f.states.at(-1), 'speaking');
  f.narrator.stop(); f.narrator.speak('Next page'); await settle();
  finish(new Blob(['next page'])); await settle();
  assert.equal(f.elements[1]!.muted, true);
  f.narrator.stop();
});

test('browser backup speaks silently when muted and resumes at its word position rather than the whole line', () => {
  let now = 0;
  const spoken: SpeechSynthesisUtterance[] = [];
  const states: NarrationState[] = [];
  const synth = { getVoices: () => [], cancel() {}, speak: (utterance: SpeechSynthesisUtterance) => spoken.push(utterance) } as unknown as SpeechSynthesis;
  const narrator = createNarrator(synth, text => ({ text }) as SpeechSynthesisUtterance, state => states.push(state), () => now);
  const text = 'one two three four five six seven eight';
  narrator.speak(text);
  spoken[0]!.onboundary?.call(spoken[0]!, { charIndex: 4 } as SpeechSynthesisEvent);
  now = 500; narrator.setMuted(true);
  assert.equal(spoken[1]!.volume, 0); assert.equal(spoken[1]!.text, 'three four five six seven eight');
  now = 1000;
  spoken[1]!.onboundary?.call(spoken[1]!, { charIndex: 6 } as SpeechSynthesisEvent);
  narrator.setMuted(false);
  assert.equal(spoken[2]!.volume, 1); assert.equal(spoken[2]!.text, 'four five six seven eight');
  assert.equal(states.at(-1), 'speaking');
  spoken[2]!.onend?.call(spoken[2]!, {} as SpeechSynthesisEvent);
  narrator.setMuted(true); narrator.setMuted(false);
  assert.equal(spoken.length, 3); assert.equal(states.at(-1), 'idle');
});

test('autoplay denial offers a user gesture recovery without switching away from the ElevenLabs voice', async () => {
  const error = new Error('Browser requires interaction'); error.name = 'NotAllowedError';
  const f = audioFixture(async () => new Blob(['MP3']), error);
  f.narrator.speak('Opening story'); await settle();
  assert.equal(f.states.at(-1), 'blocked'); assert.deepEqual(f.browserWords, []);
  assert.deepEqual(f.revoked, ['blob:test-voice']);
  f.narrator.stop();
});

test('provider failure and audio playback failure both use the fairy-like browser backup', async () => {
  for (const rejectPlay of [false, true]) {
    const f = audioFixture(async () => {
      if (!rejectPlay) throw new Error('Provider quota exhausted');
      return new Blob(['MP3']);
    }, rejectPlay);
    f.narrator.speak('Good hit!'); await settle();
    assert.deepEqual(f.browserWords, ['Good hit!']); assert.equal(f.states.at(-1), 'speaking');
    f.narrator.stop();
  }
});

test('slow ElevenLabs falls back once; stopped or late requests never play over another page', async () => {
  let finish!: (value: Blob) => void;
  const f = audioFixture(() => new Promise(resolve => { finish = resolve; }));
  f.narrator.speak('Your quest awaits!'); await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(f.browserWords, ['Your quest awaits!']);
  finish(new Blob(['late'])); await settle(); assert.equal(f.played(), 0);
  f.narrator.stop();
  const stopped = audioFixture(() => new Promise(resolve => { finish = resolve; }));
  stopped.narrator.speak('Old quest'); await settle(); stopped.narrator.stop();
  finish(new Blob(['late'])); await settle();
  assert.equal(stopped.played(), 0); assert.deepEqual(stopped.browserWords, []); assert.equal(stopped.states.at(-1), 'idle');
  stopped.narrator.speak('Next page'); await settle();
  finish(new Blob(['next page'])); await settle();
  assert.equal(stopped.played(), 1); // Advancing to a new page does not silence its narration.
  stopped.narrator.stop();
});

test('opening dialogue, guest quests and battle lines use ElevenLabs before login; generated quests use the player token', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; authorization: string | null }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), authorization: new Headers(init?.headers).get('Authorization') });
    return new Response(new Uint8Array([73, 68, 51]), { headers: { 'Content-Type': 'audio/mpeg' } });
  };
  try {
    const lines = [...MOSS_PROLOGUE.map(chapter => chapter.text.join(' ')), ...FALLBACK_BRIEFINGS,
      ...Object.values(MOSS_REACTIONS).flat(), ...Object.values(MOSS_ENDINGS), MOSS_CHEER];
    for (const text of lines) await loadMossAudio(text, async () => { throw new Error('Built-in speech must not require login'); }, new AbortController().signal);
    assert.equal(calls.length, lines.length);
    assert.ok(calls.every(call => call.url.endsWith('/voice/speak') && !call.url.includes('/api/') && call.authorization === null));
    await loadMossAudio(lines[0]!, async () => 'unused', new AbortController().signal);
    assert.equal(calls.length, lines.length); // Browser audio replay is cached.
    await loadMossAudio('Your evil twin has enchanted a new imaginary quest for this test!', async () => 'test-token', new AbortController().signal);
    assert.ok(calls.at(-1)!.url.endsWith('/api/voice/speak'));
    assert.equal(calls.at(-1)!.authorization, 'Bearer test-token');
  } finally { globalThis.fetch = original; }
});

test('missing speech support and playback errors leave narration unavailable without throwing', () => {
  const states: NarrationState[] = [];
  const missing = createNarrator(undefined, () => { throw new Error('Must not instantiate'); }, state => states.push(state));
  assert.equal(missing.available, false); missing.speak('Hello');
  assert.equal(states.at(-1), 'unavailable');
  const synth = { getVoices: () => [], speak: () => { throw new Error('Audio blocked'); } } as unknown as SpeechSynthesis;
  createNarrator(synth, text => ({ text }) as SpeechSynthesisUtterance, state => states.push(state)).speak('Hello');
  assert.equal(states.at(-1), 'unavailable');
});

test('Moss reacts to confirmed hits and misses from the player’s perspective, not to trigger presses', () => {
  const hit = { kind: 'hit', attacker: 'p1', victim: 'p2', spellId: 'flame', damage: 10, blocked: false } as const;
  assert.equal(mossReaction(hit, 'p1', 0), 'Good hit!');
  assert.ok(MOSS_REACTIONS.hurt.includes(mossReaction(hit, 'p2', 0) as typeof MOSS_REACTIONS.hurt[number]));
  assert.notEqual(mossReaction(hit, 'p1', 0), mossReaction(hit, 'p1', 1));
  assert.equal(mossReaction({ kind: 'cast', slot: 'p1', spellId: 'flame' }, 'p1', 0), null);
  assert.equal(mossReaction({ kind: 'miss', attacker: 'p1', spellId: 'flame' }, 'p1', 0), 'That one missed!');
  assert.equal(mossReaction({ kind: 'miss', attacker: 'p2', spellId: 'flame' }, 'p1', 0), null);
  assert.ok(mossReaction({ kind: 'heal', slot: 'p1', amount: 10 }, 'p1', 0));
});
