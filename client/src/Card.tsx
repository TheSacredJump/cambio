import { motion, type Transition } from 'motion/react';
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { Face } from '../../shared/cards';
import { CardFace, faceLabel } from './art';
import { useMotionPrefs } from './prefs';

export interface CardSpec {
  id: string;
  /** Centre position, rotation (deg) and scale relative to the base card. */
  x: number;
  y: number;
  rot: number;
  s: number;
  z: number;
  faceUp: boolean;
  face?: Face;
  /** Lifted off the table (held, peeked, shown). */
  elevated: boolean;
  /** Seconds before this card starts moving (dealing). */
  delay: number;
  flipDelay: number;
  /** Where a card that just appeared comes from. Only read on mount. */
  spawn?: { x: number; y: number; rot: number; s: number };
  /** Asked for by the current step: gets a ring. */
  selectable: boolean;
  /** Responds to a click at all (a selectable card, or one you could flip). */
  clickable: boolean;
  selected: boolean;
  /** Hue of another player pointing at this card. */
  hint: number | null;
  dim: boolean;
  tone: 'wrong' | 'peek' | null;
  label: string;
}

const MOVE: Transition = { type: 'spring', stiffness: 230, damping: 27 };
const SCALE: Transition = { type: 'spring', stiffness: 380, damping: 30 };
const FLIP: Transition = { type: 'spring', stiffness: 200, damping: 21 };
const FAST: Transition = { duration: 0.16, ease: 'easeOut' };

let flightSeq = 0;

interface Props extends CardSpec {
  base: number;
  onTap: (id: string) => void;
}

export const Card = memo(function Card(p: Props) {
  const { reduced } = useMotionPrefs();
  const hopRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const last = useRef(p.spawn ? { x: p.spawn.x, y: p.spawn.y } : { x: p.x, y: p.y });
  const lastFaceUp = useRef(p.spawn ? false : p.faceUp);
  const [flight, setFlight] = useState(0);
  const [shown, setShown] = useState<Face | undefined>(p.face);
  const w = p.base;
  const h = p.base * 1.4;

  // Keep the face painted while the card turns back over, then drop it from the DOM.
  useEffect(() => {
    if (p.face) {
      setShown(p.face);
      return;
    }
    const t = setTimeout(() => setShown(undefined), 700);
    return () => clearTimeout(t);
  }, [p.face?.rank, p.face?.suit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Travel: lift the card off the table in an arc and lean it into the direction of motion.
  useLayoutEffect(() => {
    const from = last.current;
    last.current = { x: p.x, y: p.y };
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 8) return;
    const seq = ++flightSeq;
    setFlight(seq);
    const delayMs = p.delay * 1000;
    const dur = reduced ? 170 : Math.min(780, 420 + dist * 0.34);
    if (!reduced) {
      const lift = Math.min(70, 12 + dist * 0.1);
      const lean = Math.max(-10, Math.min(10, dx * 0.028));
      hopRef.current?.animate(
        [
          { transform: 'translateY(0) rotate(0deg) scale(1)' },
          { transform: `translateY(${-lift}px) rotate(${lean}deg) scale(1.05)`, offset: 0.4 },
          { transform: 'translateY(0) rotate(0deg) scale(1)' },
        ],
        { duration: dur, delay: delayMs, easing: 'cubic-bezier(.3,0,.22,1)' },
      );
      // A small settle as it lands.
      pulseRef.current?.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(.975)' }, { transform: 'scale(1.012)' }, { transform: 'scale(1)' }],
        { duration: 300, delay: delayMs + dur - 70, easing: 'ease-out' },
      );
    }
    const t = setTimeout(() => setFlight((f) => (f === seq ? 0 : f)), dur + delayMs + 40);
    return () => clearTimeout(t);
  }, [p.x, p.y]); // eslint-disable-line react-hooks/exhaustive-deps

  // A turning card rises a little at the midpoint of the flip.
  useEffect(() => {
    if (lastFaceUp.current === p.faceUp) return;
    lastFaceUp.current = p.faceUp;
    if (reduced) return;
    pulseRef.current?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.09)', offset: 0.45 }, { transform: 'scale(1)' }],
      { duration: 540, delay: p.flipDelay * 1000 + p.delay * 1000, easing: 'cubic-bezier(.3,.6,.3,1)' },
    );
  }, [p.faceUp]); // eslint-disable-line react-hooks/exhaustive-deps

  // A wrong flip shakes its head once everyone has seen it.
  useEffect(() => {
    if (p.tone !== 'wrong' || reduced) return;
    pulseRef.current?.animate(
      [0, -7, 6, -5, 4, -2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 460, delay: 520, easing: 'ease-in-out' },
    );
  }, [p.tone]); // eslint-disable-line react-hooks/exhaustive-deps

  const transition: Transition = reduced
    ? FAST
    : {
        x: { ...MOVE, delay: p.delay },
        y: { ...MOVE, delay: p.delay },
        rotate: { ...MOVE, delay: p.delay },
        scale: { ...SCALE, delay: p.delay },
      };

  const cls = [
    'card',
    p.selectable && 'is-selectable',
    p.clickable && 'is-clickable',
    p.selected && 'is-selected',
    p.dim && 'is-dim',
    p.tone && `tone-${p.tone}`,
    p.hint !== null && 'is-hinted',
    (p.elevated || flight) && 'is-up',
  ]
    .filter(Boolean)
    .join(' ');

  const style: CSSProperties & Record<string, string | number> = {
    width: w,
    height: h,
    zIndex: flight ? 2000 + (flight % 5000) : p.z,
  };
  if (p.hint !== null) style['--hint'] = p.hint;

  return (
    <motion.div
      className={cls}
      style={style}
      initial={p.spawn ? { x: p.spawn.x - w / 2, y: p.spawn.y - h / 2, rotate: p.spawn.rot, scale: p.spawn.s } : false}
      animate={{ x: p.x - w / 2, y: p.y - h / 2, rotate: p.rot, scale: p.s }}
      transition={transition}
      role={p.clickable ? 'button' : undefined}
      tabIndex={p.clickable ? 0 : -1}
      aria-label={p.label + (p.face && p.faceUp ? `: ${faceLabel(p.face)}` : '')}
      aria-pressed={p.selectable ? p.selected : undefined}
      onClick={p.clickable ? () => p.onTap(p.id) : undefined}
      onKeyDown={
        p.clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                p.onTap(p.id);
              }
            }
          : undefined
      }
    >
      <div className="card-shadow" />
      <div className="card-hop" ref={hopRef}>
        <div className="card-pulse" ref={pulseRef}>
          <div className="card-lift">
            <motion.div
              className="flipper"
              initial={{ rotateY: p.spawn ? 180 : p.faceUp ? 0 : 180 }}
              animate={{ rotateY: p.faceUp ? 0 : 180 }}
              transition={reduced ? { duration: 0.12 } : { ...FLIP, delay: p.flipDelay + p.delay }}
              style={{ transformPerspective: Math.round(w * 8) }}
            >
              <div className="face front">{shown && <CardFace face={shown} />}</div>
              <div className="face back" />
            </motion.div>
            <div className="card-ring" />
            <div className="card-dim" />
          </div>
        </div>
      </div>
    </motion.div>
  );
});
