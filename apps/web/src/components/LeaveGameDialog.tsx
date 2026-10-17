import { useEffect, useRef, useSyncExternalStore } from 'react';
import { leaveConfirmation } from '../story/confirmLeaveGame';

/** Native dialog supplies focus trapping and an inert backdrop; all visuals belong to the game. */
export function LeaveGameDialog({ scope }: { scope: string }) {
  const open = useSyncExternalStore(leaveConfirmation.subscribe, leaveConfirmation.snapshot, leaveConfirmation.snapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  // A room closing, a new screen, or unmounting must cancel an old unanswered request.
  useEffect(() => () => leaveConfirmation.resolve(false), [scope]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) { element.showModal(); stay.current?.focus(); }
    else if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} className="leave-dialog" aria-labelledby="leave-dialog-title" aria-describedby="leave-dialog-question"
    onCancel={event => { event.preventDefault(); leaveConfirmation.resolve(false); }}
    onClose={() => { if (!dialog.current?.open) leaveConfirmation.resolve(false); }}>
    <section className="parchment leave-dialog-card">
      <button type="button" className="leave-dialog-close" aria-label="Cancel leaving and close dialog"
        onClick={() => leaveConfirmation.resolve(false)}>×</button>
      <div className="leave-dialog-portrait" aria-hidden="true"><span className="leave-dialog-spark">✦</span><div className="npc-moss" /><span className="leave-dialog-spark">✧</span></div>
      <span className="leave-dialog-kicker">A note from Moss</span>
      <h2 id="leave-dialog-title">Close this chapter?</h2>
      <p id="leave-dialog-question">Are you sure you want to leave the game?</p>
      <p className="leave-dialog-note">The glade is a little brighter with you here.</p>
      <div className="leave-dialog-actions">
        <button ref={stay} type="button" className="quest-button" onClick={() => leaveConfirmation.resolve(false)}>Keep playing <span aria-hidden="true">✦</span></button>
        <button type="button" className="secondary-button leave-game-button" onClick={() => leaveConfirmation.resolve(true)}>Leave game <span aria-hidden="true">↗</span></button>
      </div>
    </section>
  </dialog>;
}
