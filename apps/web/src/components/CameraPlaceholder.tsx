/** Placeholder for the webcam frame (bottom-right in the mockup). Computer vision tracking comes later. */
export function CameraPlaceholder() {
  return (
    <div className="camera-frame" aria-label="Camera placeholder">
      <div><span className="camera-sigil" aria-hidden="true">◇</span><span>Your looking glass</span><small>Camera view · coming soon</small></div>
    </div>
  );
}
