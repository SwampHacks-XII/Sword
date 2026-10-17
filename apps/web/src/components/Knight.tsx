/** The pixel knight, playing its six-frame idle from knight-idle.png. Decorative unless given a label. */
export function Knight({ className = '', label }: { className?: string; label?: string }) {
  return label
    ? <div className={`knight-sprite ${className}`} role="img" aria-label={label} />
    : <div className={`knight-sprite ${className}`} aria-hidden="true" />;
}
