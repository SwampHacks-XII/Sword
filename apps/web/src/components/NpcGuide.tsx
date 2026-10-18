import type { ReactNode } from 'react';

export function NpcGuide({ message, compact = false, badge, voice }: {
  message: string; compact?: boolean; badge?: ReactNode;
  /** Moss's voice controls, shown beside the caption. */
  voice?: ReactNode;
}) {
  const portrait = <div className="npc-moss" role="img" aria-label="Moss, a tiny smiling green forest spirit with a pink flower, flapping its leafy wings" />;
  return <aside className={`npc-guide ${compact ? 'npc-guide-compact' : ''}`} aria-label="Moss, your story guide">
    {compact ? <div className="npc-portrait">{portrait}{badge}</div> : portrait}
    <div className="npc-caption"><p>{message}</p>{voice}</div>
  </aside>;
}
