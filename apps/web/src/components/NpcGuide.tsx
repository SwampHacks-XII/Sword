export function NpcGuide({ message, compact = false }: { message: string; compact?: boolean }) {
  return <aside className={`npc-guide ${compact ? 'npc-guide-compact' : ''}`} aria-label="Moss, your story guide">
    <div className="npc-moss" role="img" aria-label="Moss, a tiny smiling green forest spirit with a pink flower, flapping its leafy wings" />
    <div className="npc-caption"><p>{message}</p></div>
  </aside>;
}
