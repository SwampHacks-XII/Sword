/**
 * The pixel knight, playing a boomerang idle. `sword` uses knight-idle.png; `plain` is the
 * swordless hero from knight-plain.png, before Moss hands over the sword. Decorative unless given a label.
 */
export function Knight({ className = '', label, plain = false }: { className?: string; label?: string; plain?: boolean }) {
  const classes = `knight-sprite ${plain ? 'knight-plain' : ''} ${className}`;
  return label
    ? <div className={classes} role="img" aria-label={label} />
    : <div className={classes} aria-hidden="true" />;
}
