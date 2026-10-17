export function NpcGuide({ message, compact = false }: { message: string; compact?: boolean }) {
  return <aside className={`npc-guide ${compact ? 'npc-guide-compact' : ''}`} aria-label="Moss, your story guide">
    <img className="npc-moss" src="/art/moss.svg" alt="Moss, a tiny smiling forest spirit in a green wizard hat" width="220" height="240" />
    <div className="npc-caption"><p>{message}</p></div>
  </aside>;
}
