import { useEffect } from 'react';
import type { Gesture, SwordColor } from '../game/types';
import type { DevSwordInput } from '../net/messages';
import { useMatch } from './useMatch';

export const KEY_BUTTONS: Record<string, SwordColor> = { '1': 'red', '2': 'yellow', '3': 'green', '4': 'blue' };
export const KEY_GESTURES: Record<string, Gesture> = { q: 'swing_left', e: 'swing_right', r: 'wrist_rotate', w: 'upright' };
export const GESTURE_KEYS: Record<Gesture, string> = { swing_left: 'Q', swing_right: 'E', wrist_rotate: 'R', upright: 'W' };

/** Keyboard stand-in for your sword until the hardware is connected. */
export function useKeyboardSword(enabled: boolean) {
  const { send } = useMatch();
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      let input: DevSwordInput | null = null;
      if (KEY_BUTTONS[key]) input = { kind: 'button', color: KEY_BUTTONS[key] };
      else if (KEY_GESTURES[key]) input = { kind: 'gesture', gesture: KEY_GESTURES[key] };
      else if (key === ' ') input = { kind: 'trigger' };
      if (!input) return;
      event.preventDefault();
      send({ type: 'dev.sword', input });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, send]);
}
