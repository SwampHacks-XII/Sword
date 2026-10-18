/** Toggles the future webcam view; sits on the battle status paper. */
export function CameraToggle({ id, hidden, onToggle }: { id: string; hidden: boolean; onToggle(): void }) {
  const label = hidden ? 'Show camera' : 'Hide camera';
  return (
    <button type="button" className="camera-toggle" aria-expanded={!hidden} aria-controls={id}
      aria-label={label} title={label} onClick={onToggle}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 8h4l2-3h6l2 3h4v11H3V8Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="12" cy="13" r="3.5" stroke="currentColor" strokeWidth="2" />
      </svg>
    </button>
  );
}

/** Future webcam view, anchored at the bottom to the left of the spell instructions. */
export function CameraPlaceholder({ id, hidden }: { id: string; hidden: boolean }) {
  return (
    <div className="camera-widget">
      <div id={id} className="camera-frame" hidden={hidden} aria-label="Camera placeholder">
        <div><span className="camera-sigil" aria-hidden="true">◇</span><span>Your looking glass</span><small>Camera view · coming soon</small></div>
      </div>
    </div>
  );
}
