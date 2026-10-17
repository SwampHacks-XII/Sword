import type { ReactNode } from 'react';

/** Shared parchment surface for the storybook interface. */
export function Parchment({ title, className = '', children }: { title?: string; className?: string; children: ReactNode }) {
  return (
    <section className={`parchment ${className}`}>
      {title && <h2 className="parchment-title">{title}</h2>}
      {children}
    </section>
  );
}
