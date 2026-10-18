import { Knight } from './Knight';

export function WorldBackdrop({ showKnights }: { showKnights: boolean }) {
  return <div className="storybook-world" aria-hidden="true">
    <div className="pixel-landscape"><div className="landscape-strip sky" /><div className="landscape-strip grass" /></div><div className="wandering-clouds" /><div className="world-haze" />
    <div className="fireflies">{Array.from({ length: 14 }, (_, index) => <i key={index}
      style={{ left: `${(index * 37 + 8) % 100}%`, top: `${(index * 19 + 21) % 85}%`, animationDelay: `${index * -.7}s` }} />)}</div>
    {showKnights && <div className="duel-illustration">
      <div className="distant-knight"><Knight /></div>
      <div className="near-knight"><Knight /></div>
      <span className="duel-caption">Every hero has a shadow.</span>
    </div>}
  </div>;
}
