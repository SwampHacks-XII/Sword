import { useId, useState } from 'react';

/** Future webcam view, anchored at the bottom to the left of the spell instructions. */
export function CameraPlaceholder() {
  const [hidden, setHidden] = useState(false);
  const cameraId = useId();
  return (
    <div className={`camera-widget${hidden ? ' is-collapsed' : ''}`}>
      <button type="button" className="camera-toggle" aria-expanded={!hidden} aria-controls={cameraId}
        onClick={() => setHidden(value => !value)}>
        <span aria-hidden="true">{hidden ? '◇' : '−'}</span>{hidden ? 'Show camera' : 'Hide camera'}
      </button>
      <div id={cameraId} className="camera-frame" hidden={hidden} aria-label="Camera placeholder">
        <div><span className="camera-sigil" aria-hidden="true">◇</span><span>Your looking glass</span><small>Camera view · coming soon</small></div>
      </div>
    </div>
  );
}
