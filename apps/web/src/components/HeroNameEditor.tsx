import type { PlayerNameState } from '../net/playerName';

export function HeroNameEditor({ profile, busy, onChange, onSave, onEdit, onCancel, onRetry }: {
  profile: PlayerNameState; busy: boolean; onChange(value: string): void;
  onSave(): Promise<boolean>; onEdit(): void; onCancel(): void; onRetry(): Promise<void>;
}) {
  if (profile.status === 'loading') return <p className="hint" role="status">Loading your hero’s name…</p>;
  if (profile.status === 'error') return <div>
    <p className="error" role="alert">{profile.error}</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void onRetry()}>Try again</button>
  </div>;
  if (profile.status === 'ready') return <div className="hero-identity" aria-live="polite">
    <strong className="book-hero-name">{profile.savedName}</strong>
    <button type="button" className="link-button small" disabled={busy} onClick={onEdit} aria-label="Edit hero name">Edit</button>
  </div>;
  const saving = profile.status === 'saving';
  return <form className="hero-name-form" onSubmit={event => { event.preventDefault(); if (!busy) void onSave(); }}>
    <label className="field">
      <span>Your hero’s name</span>
      <input value={profile.draft} maxLength={40} disabled={busy || saving} onChange={event => onChange(event.target.value)} />
    </label>
    {profile.authenticated && <div className="hero-name-actions">
      <button type="submit" className="secondary-button" disabled={busy || saving || !profile.draft.trim()}>{saving ? 'Saving…' : 'Save name'}</button>
      {profile.savedName !== null && <button type="button" className="link-button small" disabled={busy || saving} onClick={onCancel}>Cancel</button>}
    </div>}
    {profile.error && <p className="error" role="alert">{profile.error}</p>}
    {!profile.draft.trim() && <p className="hint">Enter a player name to continue.</p>}
  </form>;
}
