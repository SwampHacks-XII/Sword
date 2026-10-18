import { Knight } from './Knight';

type Cloud = { top: number; width: number; opacity: number; duration: number; shape: 'a' | 'b' };

// Far clouds sit behind the hills and drift slowly; near clouds pass in front, larger and quicker.
const FAR_CLOUDS: Cloud[] = [
  { top: 6, width: 12, opacity: .28, duration: 190, shape: 'a' },
  { top: 18, width: 9, opacity: .22, duration: 230, shape: 'b' },
  { top: 11, width: 15, opacity: .25, duration: 170, shape: 'b' },
  { top: 27, width: 10, opacity: .2, duration: 210, shape: 'a' },
  { top: 3, width: 8, opacity: .18, duration: 250, shape: 'a' },
];
const NEAR_CLOUDS: Cloud[] = [
  { top: 14, width: 28, opacity: .32, duration: 95, shape: 'b' },
  { top: 32, width: 22, opacity: .26, duration: 120, shape: 'a' },
  { top: 4, width: 34, opacity: .22, duration: 140, shape: 'a' },
  { top: 40, width: 18, opacity: .2, duration: 80, shape: 'b' },
];

function CloudLayer({ clouds, layer }: { clouds: Cloud[]; layer: 'far' | 'near' }) {
  return <div className={`cloud-layer ${layer}`}>{clouds.map((cloud, index) => <i key={index} className={`pixel-cloud shape-${cloud.shape}`}
    style={{
      top: `${cloud.top}%`, width: `${cloud.width}vw`, opacity: cloud.opacity, animationDuration: `${cloud.duration}s`,
      // Negative delays spread the clouds across the sky on first paint instead of all entering from the edge.
      animationDelay: `${-cloud.duration * ((index * .37 + .15) % 1)}s`,
    }} />)}</div>;
}

export function WorldBackdrop({ showKnights }: { showKnights: boolean }) {
  return <div className="storybook-world" aria-hidden="true">
    <div className="pixel-landscape">
      <div className="landscape-strip sky" />
      <div className="night-stars">{Array.from({ length: 26 }, (_, index) => <i key={index} className={index % 4 === 0 ? 'big' : undefined}
        style={{ left: `${(index * 41 + 5) % 100}%`, top: `${(index * 23 + 3) % 42}%`, animationDuration: `${2.4 + (index * 7 % 5) * .6}s`, animationDelay: `${index * -.53}s` }} />)}</div>
      <CloudLayer clouds={FAR_CLOUDS} layer="far" />
      <div className="landscape-strip grass" />
    </div>
    <div className="wandering-clouds" />
    <CloudLayer clouds={NEAR_CLOUDS} layer="near" />
    <div className="world-haze" />
    <div className="fireflies">{Array.from({ length: 14 }, (_, index) => <i key={index}
      style={{ left: `${(index * 37 + 8) % 100}%`, top: `${(index * 19 + 21) % 85}%`, animationDelay: `${index * -.7}s` }} />)}</div>
    {showKnights && <div className="duel-illustration">
      <div className="distant-knight"><Knight /></div>
      <div className="near-knight"><Knight /></div>
    </div>}
  </div>;
}
