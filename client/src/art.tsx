import { memo } from 'react';
import { isRed, POWERS, powerOf, type Face, type Suit } from '../../shared/cards';

const SUIT_PATHS: Record<Suit, string> = {
  H: 'M50 90C24 70 6 54 6 32 6 17 17 7 30 7c9 0 16 5 20 13 4-8 11-13 20-13 13 0 24 10 24 25 0 22-18 38-44 58z',
  D: 'M50 3Q65 30 87 50 65 70 50 97 35 70 13 50 35 30 50 3z',
  S: 'M50 4c13 20 42 33 42 56 0 14-11 23-23 23-8 0-13-4-16-9 1 9 4 15 10 21H37c6-6 9-12 10-21-3 5-8 9-16 9-12 0-23-9-23-23C8 37 37 24 50 4z',
  C: 'M50 8a19 19 0 0 1 16 29 19 19 0 1 1-12 34c1 9 4 16 10 22H36c6-6 9-13 10-22a19 19 0 1 1-12-34A19 19 0 0 1 50 8z',
};

export function SuitGlyph({ suit, className }: { suit: Suit; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path d={SUIT_PATHS[suit]} />
    </svg>
  );
}

function JokerStar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <g transform="translate(50 50)">
        <rect x="-26" y="-26" width="52" height="52" className="js-a" />
        <rect x="-26" y="-26" width="52" height="52" transform="rotate(45)" className="js-b" />
        <circle r="9" className="js-c" />
      </g>
    </svg>
  );
}

const SUIT_NAME: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

export function faceLabel(f: Face) {
  if (f.rank === 'JK') return `${isRed(f.suit) ? 'Red' : 'Black'} Joker`;
  const names: Record<string, string> = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };
  return `${names[f.rank] ?? f.rank} of ${SUIT_NAME[f.suit]}`;
}

export function caption(f: Face): string | null {
  if (f.rank === 'K' && isRed(f.suit)) return 'minus one';
  const p = powerOf(f);
  return p ? POWERS[p].rhyme : null;
}

function Index({ face }: { face: Face }) {
  if (face.rank === 'JK') {
    return (
      <div className="cf-index cf-index-joker">
        {'JOKER'.split('').map((ch, i) => (
          <span key={i}>{ch}</span>
        ))}
      </div>
    );
  }
  return (
    <div className="cf-index">
      <span className={`cf-rank${face.rank === '10' ? ' cf-ten' : ''}${face.rank === '6' || face.rank === '9' ? ' cf-under' : ''}`}>
        {face.rank}
      </span>
      <SuitGlyph suit={face.suit} className="cf-isuit" />
    </div>
  );
}

export const CardFace = memo(function CardFace({ face }: { face: Face }) {
  const red = isRed(face.suit);
  const court = face.rank === 'J' || face.rank === 'Q' || face.rank === 'K';
  const cap = caption(face);
  let center;
  if (face.rank === 'JK') center = <JokerStar className="cf-star" />;
  else if (court)
    center = (
      <div className="cf-court">
        <span className="cf-letter">{face.rank}</span>
        <SuitGlyph suit={face.suit} className="cf-csuit" />
      </div>
    );
  else center = <SuitGlyph suit={face.suit} className={face.rank === 'A' ? 'cf-pip cf-ace' : 'cf-pip'} />;

  return (
    <div className={`cf ${red ? 'is-red' : 'is-black'}${court ? ' is-court' : ''}${face.rank === 'JK' ? ' is-joker' : ''}`}>
      {court && <div className="cf-frame" />}
      <Index face={face} />
      <div className="cf-br">
        <Index face={face} />
      </div>
      <div className="cf-center">{center}</div>
      {cap && <div className="cf-caption">{cap}</div>}
    </div>
  );
});

// ───────────────────────────── card back

function rosette(cx: number, cy: number, r0: number, amp: number, petals: number, strands: number, w: number) {
  let out = '';
  for (let k = 0; k < strands; k++) {
    const ph = (k / strands) * ((2 * Math.PI) / petals);
    let d = '';
    const N = 360;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const r = r0 + amp * Math.sin(petals * t + ph) + amp * 0.42 * Math.sin(petals * 2 * t - ph * 3);
      const x = cx + r * Math.cos(t);
      const y = cy + r * Math.sin(t);
      d += `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    out += `<path d="${d}Z" fill="none" stroke="#d8bb7c" stroke-width="${w}" stroke-opacity="0.62"/>`;
  }
  return out;
}

/** The oxblood-and-brass back, drawn once and shared by every card as a background image. */
export const BACK_SVG = (() => {
  const W = 100;
  const H = 140;
  const lattice = `<pattern id="l" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H7M0 0V7" stroke="#c9a45c" stroke-width="0.35" stroke-opacity="0.32"/></pattern>`;
  const glow = `<radialGradient id="g" cx="50%" cy="50%" r="62%"><stop offset="0" stop-color="#6e2430"/><stop offset="1" stop-color="#3f1219"/></radialGradient>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs>${glow}${lattice}</defs><rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#l)"/><rect x="3.2" y="3.2" width="${W - 6.4}" height="${H - 6.4}" rx="2.2" fill="none" stroke="#d8bb7c" stroke-width="0.55" stroke-opacity="0.75"/><rect x="5" y="5" width="${W - 10}" height="${H - 10}" rx="1.6" fill="none" stroke="#d8bb7c" stroke-width="0.25" stroke-opacity="0.5"/><circle cx="50" cy="70" r="30" fill="#4a151d" fill-opacity="0.85"/>${rosette(50, 70, 21, 5.2, 9, 9, 0.32)}${rosette(50, 70, 9.5, 2.4, 6, 6, 0.26)}<circle cx="50" cy="70" r="2.2" fill="#d8bb7c" fill-opacity="0.85"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
})();

export const GRAIN = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.1 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
})();
