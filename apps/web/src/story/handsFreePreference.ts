// Opt in once per game session; page turns share the preference, never the microphone.
let enabled = false;
const subscribers = new Set<() => void>();
export const handsFreePreference = {
  snapshot: () => enabled,
  subscribe(callback: () => void) { subscribers.add(callback); return () => { subscribers.delete(callback); }; },
  set(value: boolean) {
    if (value === enabled) return;
    enabled = value;
    subscribers.forEach(callback => callback());
  },
};
