import { AnimatePresence, motion } from 'motion/react';
import { useState, type CSSProperties } from 'react';
import type { GameView, PlayerView, RoomView } from '../../shared/protocol';
import type { Seat } from './layout';
import { net } from './net';
import { setPrefs, useMotionPrefs } from './prefs';
import { RulesSheet } from './Rules';

export interface Btn {
  label: string;
  onClick: () => void;
  kind: 'primary' | 'ghost' | 'cambio' | 'link';
}

/** The one small thing the player can do right now, if anything. */
export interface ControlSpec {
  key: string;
  label?: string;
  italic?: boolean;
  /** Shows a draining line for a choice that lapses. */
  timer?: number;
  buttons: Btn[];
}

const fade = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.16 } },
  transition: { type: 'spring' as const, stiffness: 520, damping: 34 },
};

export function Controls({ y, controls }: { y: number; controls: ControlSpec | null }) {
  return (
    <div className="controls" style={{ top: y }}>
      <AnimatePresence mode="popLayout">
        {controls && (
          <motion.div key={controls.key} className="controls-inner" {...fade}>
            {controls.label && <span className={`controls-label${controls.italic ? ' is-italic' : ''}`}>{controls.label}</span>}
            {controls.buttons.map((b) => (
              <button key={b.label} className={`btn btn-${b.kind}`} onClick={b.onClick}>
                {b.label}
              </button>
            ))}
            {controls.timer && <span className="controls-timer" style={{ animationDuration: `${controls.timer}ms` }} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A dealer's call for the big moments: Cambio, someone out, a skip. */
export function Callout({ y, item }: { y: number; item: { id: number; title: string; sub?: string } | null }) {
  return (
    <div className="callout" style={{ top: y }} aria-live="polite">
      <AnimatePresence>
        {item && (
          <motion.div
            key={item.id}
            className="callout-inner"
            initial={{ opacity: 0, y: 10, scale: 0.92, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <span className="callout-title">{item.title}</span>
            {item.sub && <span className="callout-sub">{item.sub}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The small question mark in the corner that opens the rules. */
export function RulesButton({ limit }: { limit: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="rules-btn" onClick={() => setOpen(true)} aria-label="Rules" title="Rules">
        ?
      </button>
      <AnimatePresence>{open && <RulesSheet key="rules" onClose={() => setOpen(false)} limit={limit} />}</AnimatePresence>
    </>
  );
}

export function Nameplate(p: {
  seat: Seat;
  name: string;
  me: boolean;
  hue: number;
  bot: boolean;
  away: boolean;
  active: boolean;
  player: PlayerView;
  game: GameView;
  total: number;
  targetable: boolean;
  onPick: () => void;
}) {
  const { game, player } = p;
  const chips: { label: string; cls: string }[] = [];
  if (player.out) chips.push({ label: 'Out', cls: 'chip-out' });
  if (game.caller === player.id) chips.push({ label: 'Cambio', cls: 'chip-cambio' });
  if (player.skipPending) chips.push({ label: 'Skip', cls: 'chip-skip' });
  if (player.immune) chips.push({ label: 'Immune', cls: 'chip-immune' });
  if (game.phase === 'peek' && player.ready) chips.push({ label: 'Ready', cls: 'chip-ready' });
  if (p.away) chips.push({ label: 'Away', cls: 'chip-away' });
  const compact = p.seat.plateMax !== undefined;
  if (compact && chips.length > 1) chips.splice(1);

  const style = {
    transform: `translate(${p.seat.plate.x}px, ${p.seat.plate.y}px) translate(-50%, -50%)`,
    '--hue': p.hue,
    maxWidth: p.seat.plateMax,
  } as CSSProperties;

  const body = (
    <>
      <span className="plate-dot" />
      <span className="plate-name">
        {p.me ? 'You' : p.name}
        {p.bot && !compact && <span className="plate-bot">bot</span>}
      </span>
      {game.round > 1 || p.total > 0 ? <span className="plate-total">{p.total}</span> : null}
      <AnimatePresence initial={false}>
        {chips.map((c) => (
          <motion.span
            key={c.label}
            className={`chip ${c.cls}`}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          >
            {c.label}
          </motion.span>
        ))}
      </AnimatePresence>
    </>
  );

  const cls = `plate${player.out ? ' is-out' : ''}${p.active ? ' is-active' : ''}${p.me ? ' is-me' : ''}${p.targetable ? ' is-target' : ''}`;
  return p.targetable ? (
    <button className={cls} style={style} onClick={p.onPick}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

export function Ticker({ items }: { items: { id: number; text: string }[] }) {
  return (
    <div className="ticker" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <motion.div
            key={it.id}
            className="ticker-item"
            layout
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          >
            {it.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function TopBar({ room }: { room: RoomView }) {
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const prefs = useMotionPrefs();
  const link = `${location.origin}${location.pathname}?table=${room.code}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard refused; the code is still visible */
    }
  };
  return (
    <div className="topbar">
      <button className="code-chip" onClick={copy} title="Copy the invite link">
        <span className="code-chip-v">{copied ? 'Copied' : room.code}</span>
      </button>
      <div className="menu-wrap">
        <button className="icon-btn" onClick={() => setMenu((v) => !v)} aria-label="Menu" aria-expanded={menu}>
          <svg viewBox="0 0 24 24">
            <circle cx="6" cy="12" r="1.3" />
            <circle cx="12" cy="12" r="1.3" />
            <circle cx="18" cy="12" r="1.3" />
          </svg>
        </button>
        <AnimatePresence>
          {menu && (
            <motion.div
              className="menu"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.18 }}
            >
              <button onClick={copy}>Copy invite link</button>
              <button onClick={() => setPrefs({ sound: !prefs.sound })}>{prefs.sound ? 'Sound off' : 'Sound on'}</button>
              <button onClick={() => setPrefs({ motion: prefs.reduced ? 'full' : 'reduced' })}>
                {prefs.reduced ? 'Full animation' : 'Reduce motion'}
              </button>
              <button
                className="menu-danger"
                onClick={() => {
                  setMenu(false);
                  net.leave();
                }}
              >
                Leave table
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
