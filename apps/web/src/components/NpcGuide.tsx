export function NpcGuide({ message, compact = false }: { message: string; compact?: boolean }) {
  const portrait = <div className="npc-moss" role="img" aria-label="Moss, a tiny smiling green forest spirit with a pink flower, flapping its leafy wings" />;
  return <aside className={`npc-guide ${compact ? 'npc-guide-compact' : ''}`} aria-label="Moss, your story guide">
    {compact ? <div className="npc-portrait">{portrait}</div> : portrait}
    <div className="npc-caption"><p>{message}</p></div>
  </aside>;
}
