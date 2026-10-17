/** A shared request lets buttons and voice await the same in-game confirmation. */
export function createLeaveConfirmation() {
  let pending: ((confirmed: boolean) => void) | null = null;
  const listeners = new Set<() => void>();
  return {
    snapshot: () => pending !== null,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    request(): Promise<boolean> {
      // Repeated clicks must not queue several leave actions behind one confirmation.
      if (pending) return Promise.resolve(false);
      const answer = new Promise<boolean>(resolve => { pending = resolve; });
      listeners.forEach(listener => listener());
      return answer;
    },
    resolve(confirmed: boolean) {
      const answer = pending;
      if (!answer) return;
      pending = null;
      listeners.forEach(listener => listener());
      answer(confirmed);
    },
  };
}

export const leaveConfirmation = createLeaveConfirmation();
export function confirmLeaveGame(): Promise<boolean> { return leaveConfirmation.request(); }
