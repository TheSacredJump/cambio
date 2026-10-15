import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { POWERS } from '../../shared/cards';
import type { GameEvent, GameView, PlayerView } from '../../shared/protocol';
import { Card, type CardSpec } from './Card';
import { Callout, Controls, Nameplate, RulesButton, TopBar, type ControlSpec } from './Hud';
import { computeLayout, type Layout, type Seat } from './layout';
import { net, type Snapshot } from './net';
import { useMotionPrefs } from './prefs';
import { Results } from './Results';
import { sound } from './sound';
import { useViewport } from './useViewport';

type Mode =
  | { k: 'watch' }
  | { k: 'out' }
  | { k: 'over' }
  | { k: 'memorize' }
  | { k: 'waitingReady' }
  | { k: 'give'; count: number; to: string }
  | { k: 'jokerPick'; from: string }
  | { k: 'idle' }
  | { k: 'start' }
  | { k: 'drawn'; from: 'deck' | 'discard' }
  | { k: 'peekOwn' }
  | { k: 'peekOther' }
  | { k: 'viewing'; cardIds: string[] }
  | { k: 'pickTwo'; power: 'blindSwap' | 'lookSwap' }
  | { k: 'decide' }
  | { k: 'target'; power: 'skip' | 'handSwap' }
  | { k: 'again' }
  | { k: 'jokerWait' }
  | { k: 'jokerAssign' };

type Where = 'hand' | 'discardTop' | 'discard' | 'drawn' | 'pool';

function deriveMode(game: GameView, you: string): Mode {
  const me = game.players.find((p) => p.id === you);
  if (game.phase === 'reveal') return { k: 'over' };
  if (!me) return { k: 'watch' };
  if (game.phase === 'peek') return me.ready ? { k: 'waitingReady' } : { k: 'memorize' };
  if (me.out) return { k: 'out' };
  const step = game.turn.step;
  if (step.kind === 'power' && step.power === 'joker' && step.stage === 'collect' && step.joker?.waiting.includes(you))
    return { k: 'jokerPick', from: game.turn.playerId };
  if (me.owes) return { k: 'give', count: Math.min(me.owes.count, cardsOf(me).length), to: me.owes.to };
  if (game.turn.playerId !== you) return { k: 'idle' };
  switch (step.kind) {
    case 'start':
      return { k: 'start' };
    case 'drawn':
      return { k: 'drawn', from: step.from };
    case 'power':
      if (step.stage === 'viewing') return { k: 'viewing', cardIds: step.cardIds };
      switch (step.power) {
        case 'peekOwn':
          return { k: 'peekOwn' };
        case 'peekOther':
          return { k: 'peekOther' };
        case 'blindSwap':
          return { k: 'pickTwo', power: 'blindSwap' };
        case 'lookSwap':
          return step.stage === 'decide' ? { k: 'decide' } : { k: 'pickTwo', power: 'lookSwap' };
        case 'skip':
        case 'handSwap':
          return { k: 'target', power: step.power };
        case 'drawAgain':
          return { k: 'again' };
        case 'joker':
          return step.stage === 'assign' ? { k: 'jokerAssign' } : { k: 'jokerWait' };
      }
  }
  return { k: 'idle' };
}

const cardsOf = (p: PlayerView) => p.slots.filter((c): c is NonNullable<typeof c> => !!c);

/** Small deterministic jitter so the discard pile looks dropped, not stacked by a machine. */
function jitter(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const a = ((h >>> 0) % 1000) / 1000;
  const b = (((h >>> 10) >>> 0) % 1000) / 1000;
  const c = (((h >>> 20) >>> 0) % 1000) / 1000;
  return { dx: (a - 0.5) * 6, dy: (b - 0.5) * 6, rot: (c - 0.5) * 9 };
}

export function Table({ snap }: { snap: Snapshot }) {
  const game = snap.game!;
  const { you, room } = snap;
  const vp = useViewport();
  const { reduced } = useMotionPrefs();
  const L = useMemo(() => computeLayout(vp, game, you), [vp, game, you]);
  const members = useMemo(() => new Map(room.members.map((m) => [m.id, m])), [room.members]);
  const name = useCallback((id: string) => (id === you ? 'You' : members.get(id)?.name ?? 'Someone'), [members, you]);
  const hue = useCallback((id: string) => members.get(id)?.hue ?? 40, [members]);
  const me = game.players.find((p) => p.id === you) ?? null;
  const step = game.turn.step;
  const topDiscard = game.discard[game.discard.length - 1]?.id;

  const [selected, setSelected] = useState<string[]>([]);
  const mode = deriveMode(game, you);
  const modeKey = mode.k === 'give' ? `give:${mode.to}` : `${mode.k}:${game.turn.seq}:${step.kind === 'power' ? step.stage : ''}`;
  useEffect(() => setSelected([]), [modeKey]);

  // Show the active player what they are pointing at.
  useEffect(() => {
    if (mode.k === 'pickTwo') net.act({ t: 'select', cardIds: selected });
  }, [selected, mode.k]);

  // ── who owns what

  const owner = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of game.players) for (const c of p.slots) if (c) m.set(c.id, p.id);
    return m;
  }, [game]);
  const outIds = useMemo(() => new Set(game.players.filter((p) => p.out).map((p) => p.id)), [game]);

  /** Cards the current step asks you to choose from. These get a ring. */
  const canSelect = useCallback(
    (id: string, where: Where): boolean => {
      const o = owner.get(id);
      const unlocked = where === 'hand' && o !== game.caller && !outIds.has(o!);
      switch (mode.k) {
        case 'give':
        case 'jokerPick':
        case 'peekOwn':
          return where === 'hand' && o === you;
        case 'pickTwo':
          return unlocked;
        case 'start':
          return where === 'discardTop' && !!me && cardsOf(me).length > 0;
        case 'drawn':
          return (where === 'hand' && o === you) || (where === 'discardTop' && mode.from === 'deck');
        case 'peekOther':
          return where === 'hand' && o !== you && !outIds.has(o!);
        case 'jokerAssign':
          return where === 'pool';
        default:
          return false;
      }
    },
    [mode, owner, outIds, game.caller, you, me],
  );

  /** Any other card on the table: clicking it flips it onto the discard, if the rules allow. */
  const canFlip = useCallback(
    (id: string): boolean => {
      const o = owner.get(id);
      if (!o || !me || me.out || game.phase !== 'play' || !game.flip.open) return false;
      if (game.caller === you || o === game.caller || outIds.has(o)) return false;
      const claim = game.flip.claim;
      return !claim || (claim.by === you && claim.owner === o);
    },
    [owner, me, game.phase, game.flip, game.caller, outIds, you],
  );

  const jokerAssignment = step.kind === 'power' ? step.joker?.assignment ?? null : null;

  const onTap = useCallback(
    (id: string) => {
      sound.tick();
      const where: Where = id === topDiscard ? 'discardTop' : owner.has(id) ? 'hand' : 'pool';
      if (mode.k === 'viewing' && mode.cardIds.includes(id)) return net.act({ t: 'pass' });
      if (!canSelect(id, where)) {
        if (where === 'hand' && canFlip(id)) net.act({ t: 'flip', ownerId: owner.get(id)!, cardIds: [id] });
        return;
      }
      switch (mode.k) {
        case 'give':
          return net.act({ t: 'give', cardIds: [id] });
        case 'jokerPick':
          return net.act({ t: 'jokerPick', cardId: id });
        case 'start':
          return net.act({ t: 'take' });
        case 'drawn':
          if (where === 'discardTop') return net.act({ t: 'discard' });
          return net.act({ t: 'swap', cardId: id });
        case 'peekOwn':
        case 'peekOther':
          return net.act({ t: 'peek', cardId: id });
        case 'pickTwo': {
          const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(-2);
          setSelected(next);
          if (next.length === 2) net.act({ t: 'pickTwo', a: next[0], b: next[1] });
          return;
        }
        case 'jokerAssign': {
          if (!jokerAssignment) return;
          if (!selected.length) return setSelected([id]);
          const other = selected[0];
          setSelected([]);
          if (other === id) return;
          const next = { ...jokerAssignment };
          const ra = Object.keys(next).find((r) => next[r] === id)!;
          const rb = Object.keys(next).find((r) => next[r] === other)!;
          next[ra] = other;
          next[rb] = id;
          return net.act({ t: 'jokerArrange', assignment: next });
        }
      }
    },
    [mode, owner, topDiscard, selected, jokerAssignment, canSelect, canFlip],
  );

  const onDeck = () => {
    if (mode.k === 'start') net.act({ t: 'draw' });
    else if (mode.k === 'again') net.act({ t: 'again' });
  };

  const targetable = (id: string): boolean => {
    if (mode.k !== 'target' || id === you) return false;
    const p = game.players.find((x) => x.id === id)!;
    if (p.out) return false;
    return mode.power === 'skip' ? !p.immune && !p.skipPending : true;
  };

  // ── keyboard

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === 'Escape') setSelected([]);
      else if ((e.key === 'd' || e.key === 'D') && (mode.k === 'start' || mode.k === 'again')) onDeck();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // ── events: sounds, and a brief call-out for the big moments

  const [callout, setCallout] = useState<{ id: number; title: string; sub?: string } | null>(null);
  const calloutId = useRef(0);
  const firstSnap = useRef(snap.n);
  useEffect(() => {
    const isFirst = snap.n === firstSnap.current;
    for (const e of snap.events) {
      playSound(e, you, game);
      const c = isFirst ? null : calloutFor(e, name);
      if (c) setCallout({ id: ++calloutId.current, ...c });
    }
  }, [snap.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!callout) return;
    const t = setTimeout(() => setCallout((c) => (c?.id === callout.id ? null : c)), 1900);
    return () => clearTimeout(t);
  }, [callout]);

  // ── cards

  const known = useRef<Set<string> | null>(null);
  const cards = useMemo(() => {
    const dealt = snap.events.some((e) => e.type === 'deal');
    const first = known.current === null;
    const seen = known.current ?? new Set<string>();
    const specs = buildCards({ game, you, L, mode, selected, hue, canSelect, canFlip, seen, animateNew: !first || dealt });
    known.current = new Set(specs.map((c) => c.id));
    return specs;
  }, [game, you, L, mode, selected, hue, canSelect, canFlip]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── your turn: say so in the tab title, and buzz phones

  const myMove = ['start', 'jokerPick', 'memorize'].includes(mode.k);
  useEffect(() => {
    document.title = myMove ? 'Your turn · Cambio' : 'Cambio';
    if (myMove && mode.k === 'start') navigator.vibrate?.(25);
    return () => {
      document.title = 'Cambio';
    };
  }, [myMove, mode.k]);

  // ── results overlay, a beat after the cards turn over

  const [showResults, setShowResults] = useState(false);
  useEffect(() => {
    if (game.phase !== 'reveal') {
      setShowResults(false);
      return;
    }
    const t = setTimeout(() => setShowResults(true), reduced ? 300 : 2200);
    return () => clearTimeout(t);
  }, [game.phase, game.round, reduced]);

  const activeId = game.turn.playerId;
  const activeSeat = L.seats.get(activeId);
  const controls = buildControls({ mode, game, name, onDeck });
  const lamp = game.phase === 'play' ? L.lamp(activeId) : L.center;

  return (
    <div
      className={`table${L.mobile ? ' is-mobile' : ''}`}
      style={{ ['--cw' as string]: `${L.base}px` }}
      onPointerDown={() => sound.unlock()}
    >
      <div className="felt" />
      <motion.div
        className="lamp"
        initial={false}
        animate={{ x: lamp.x, y: lamp.y }}
        transition={{ type: 'spring', stiffness: 40, damping: 18 }}
      />
      <div className="grain" />

      <Wells L={L} game={game} deckActive={mode.k === 'start' || mode.k === 'again'} onDeck={onDeck} />

      {activeSeat && game.phase === 'play' && (
        <motion.div
          className="turn-halo"
          initial={false}
          animate={{
            x: activeSeat.x - activeSeat.gridW / 2 - 10,
            y: activeSeat.y - activeSeat.gridH / 2 - 10,
            width: activeSeat.gridW + 20,
            height: activeSeat.gridH + 20,
          }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          style={{ ['--hue' as string]: hue(activeId) }}
        />
      )}

      {[...L.seats.values()].map((seat) => (
        <SeatZone
          key={seat.id}
          seat={seat}
          L={L}
          clickable={targetable(seat.id)}
          onPick={() => net.act({ t: 'target', playerId: seat.id })}
        />
      ))}

      <div className="cards">
        <AnimatePresence>{step.kind === 'power' && step.power === 'joker' && <JokerTray key="tray" L={L} game={game} />}</AnimatePresence>
        {cards.map((c) => (
          <Card key={c.id} {...c} base={L.base} onTap={onTap} />
        ))}
      </div>

      {[...L.seats.values()].map((seat) => {
        const p = game.players.find((x) => x.id === seat.id)!;
        const m = members.get(seat.id);
        return (
          <Nameplate
            key={seat.id}
            seat={seat}
            name={m?.name ?? '…'}
            me={seat.id === you}
            hue={hue(seat.id)}
            bot={!!m?.isBot}
            away={!m?.connected}
            active={game.phase === 'play' && activeId === seat.id}
            player={p}
            game={game}
            total={room.totals[seat.id] ?? 0}
            targetable={targetable(seat.id)}
            onPick={() => net.act({ t: 'target', playerId: seat.id })}
          />
        );
      })}

      {game.turn.step.kind === 'power' && game.turn.step.power === 'joker' && (
        <JokerLabels L={L} game={game} name={name} />
      )}

      <Callout y={L.captionY - 16} item={callout} />
      <Controls y={L.promptY} controls={controls} />
      <TopBar room={room} />
      <RulesButton limit={game.cambioLimit} />

      <AnimatePresence>
        {showResults && game.results && <Results key="results" room={room} game={game} you={you} name={name} />}
      </AnimatePresence>
    </div>
  );
}

// ───────────────────────────────────────── pieces

function Wells({ L, game, deckActive, onDeck }: { L: Layout; game: GameView; deckActive: boolean; onDeck: () => void }) {
  const w = L.base * L.pileS;
  const h = w * 1.4;
  const depth = Math.min(7, Math.ceil(game.deckCount / 7));
  const shadows = Array.from({ length: depth }, (_, i) => `0 ${i + 1}px 0 hsl(var(--deck-edge) / ${0.9 - i * 0.08})`).join(', ');
  return (
    <>
      <div className="well" style={{ left: L.discard.x - w / 2, top: L.discard.y - h / 2, width: w, height: h }} />
      <div className="well" style={{ left: L.deck.x - w / 2, top: L.deck.y - h / 2, width: w, height: h }}>
        {game.deckCount > 0 && (
          <button
            className={`deck${deckActive ? ' is-active' : ''}`}
            style={{ boxShadow: `${shadows}, 0 ${depth + 4}px ${depth + 10}px hsl(var(--shade) / .5)`, transform: `translateY(${-depth}px)` }}
            onClick={deckActive ? onDeck : undefined}
            tabIndex={deckActive ? 0 : -1}
            aria-label={deckActive ? 'Draw from the deck' : `Deck, ${game.deckCount} cards`}
          >
            <span className="face back" />
          </button>
        )}
      </div>
    </>
  );
}

function SeatZone({ seat, L, clickable, onPick }: { seat: Seat; L: Layout; clickable: boolean; onPick: () => void }) {
  if (!clickable) return null;
  const pad = L.base * 0.12;
  return (
    <button
      className="seat-zone"
      style={{
        left: seat.x - seat.gridW / 2 - pad,
        top: seat.y - seat.gridH / 2 - pad,
        width: seat.gridW + pad * 2,
        height: seat.gridH + pad * 2,
      }}
      onClick={onPick}
      aria-label="Choose this player"
    />
  );
}

/** A felt-dark tray that holds the Joker pool above the piles. */
function JokerTray({ L, game }: { L: Layout; game: GameView }) {
  const n = Math.max(1, jokerSlots(game).length);
  const first = L.pool(0, n);
  const last = L.pool(n - 1, n);
  const cw = L.base * first.s;
  const ch = cw * 1.4;
  const padX = cw * 0.32;
  const left = first.x - cw / 2 - padX;
  const width = last.x - first.x + cw + padX * 2;
  const top = first.y - ch / 2 - 34;
  const height = ch + 34 + 36;
  return (
    <motion.div
      className="joker-tray"
      style={{ left, top, width, height, zIndex: 480 }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      <span className="eyebrow">{game.turn.step.kind === 'power' && game.turn.step.stage === 'assign' ? 'Deal to' : 'Handed over'}</span>
    </motion.div>
  );
}

function JokerLabels({ L, game, name }: { L: Layout; game: GameView; name: (id: string) => string }) {
  const step = game.turn.step;
  if (step.kind !== 'power' || !step.joker) return null;
  const ids = jokerSlots(game);
  const n = ids.length;
  const stepW = n > 1 ? L.pool(1, n).x - L.pool(0, n).x : L.base;
  return (
    <>
      {ids.map((id, i) => {
        const p = L.pool(i, n);
        const h = L.base * p.s * 1.4;
        return (
          <motion.div
            key={id}
            className="joker-label"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ left: p.x, top: p.y + h / 2 + 9, maxWidth: stepW - 4 }}
          >
            {name(id)}
          </motion.div>
        );
      })}
    </>
  );
}

/** Joker pool slots in seat order: givers while collecting, recipients while dealing. */
function jokerSlots(game: GameView): string[] {
  const step = game.turn.step;
  if (step.kind !== 'power' || !step.joker) return [];
  const involved = new Set([...step.joker.pool.map((e) => e.from), ...step.joker.waiting]);
  return game.players.map((p) => p.id).filter((id) => involved.has(id));
}

// ───────────────────────────────────────── card targets

function buildCards(o: {
  game: GameView;
  you: string;
  L: Layout;
  mode: Mode;
  selected: string[];
  hue: (id: string) => number;
  canSelect: (id: string, where: Where) => boolean;
  canFlip: (id: string) => boolean;
  seen: Set<string>;
  animateNew: boolean;
}): CardSpec[] {
  const { game, you, L, mode, selected, hue, canSelect, canFlip, seen, animateNew } = o;
  const out: CardSpec[] = [];
  const reveal = game.phase === 'reveal';
  const hintBy = game.selecting && game.selecting.by !== you ? game.selecting : null;
  const choosing = ['jokerPick', 'peekOwn', 'peekOther', 'pickTwo'].includes(mode.k);
  const viewing = mode.k === 'viewing' ? mode.cardIds : [];
  const deal = new Map<string, number>();
  if (animateNew) {
    // Deal order: round-robin from the first player, one slot at a time.
    const n = game.players.length;
    const first = game.players.findIndex((p) => p.id === game.turn.playerId);
    game.players.forEach((p, i) => {
      const seatOrder = (i - first + n) % n;
      p.slots.forEach((c, s) => c && !seen.has(c.id) && deal.set(c.id, s * n + seatOrder));
    });
  }
  const dealing = animateNew && deal.size > 8;
  const spawnFrom = { x: L.deck.x, y: L.deck.y - 4, rot: 0, s: L.pileS };
  const spawn = (id: string) => (animateNew && !seen.has(id) ? spawnFrom : undefined);
  const dealDelay = (id: string) => (dealing && deal.has(id) ? deal.get(id)! * 0.075 : 0);

  const peekedBy = new Map<string, string>();
  for (const pk of game.peeks) for (const id of pk.cardIds) peekedBy.set(id, pk.by);

  game.players.forEach((p, seatIdx) => {
    const seat = L.seats.get(p.id)!;
    p.slots.forEach((c, i) => {
      if (!c) return;
      const pos = L.slot(seat, i);
      let { x, y } = pos;
      let s = seat.s;
      let rot = 0;
      let z = 10 + i;
      let elevated = false;
      let tone: CardSpec['tone'] = null;
      const by = peekedBy.get(c.id);
      const shown = game.showcase.includes(c.id);
      const toward = (k: number) => {
        x += (L.center.x - x) * k;
        y += (L.center.y - y) * k;
      };
      if (shown) {
        s = Math.max(s * 1.25, 0.82);
        toward(seat.me ? 0.12 : 0.22);
        z = 450;
        elevated = true;
        tone = 'wrong';
      } else if (by === you && c.face) {
        elevated = true;
        z = 400;
        if (seat.me) {
          y -= L.ch * 0.02;
          s = 1.05;
        } else {
          s = Math.max(s * 1.3, 0.8);
          toward(0.18);
        }
      } else if (by && by !== you) {
        elevated = true;
        y -= L.ch * seat.s * 0.12;
        rot = -3;
        z = 300;
        tone = 'peek';
      }
      if (reveal && !seat.me) s = Math.max(s, Math.min(0.78, s * 1.12));
      const sel = selected.includes(c.id);
      const selectable = canSelect(c.id, 'hand');
      const clickable = selectable || viewing.includes(c.id) || canFlip(c.id);
      out.push({
        id: c.id,
        x,
        y,
        rot,
        s,
        z,
        faceUp: !!c.face,
        face: c.face,
        elevated,
        delay: dealDelay(c.id),
        flipDelay: reveal ? seatIdx * 0.14 + i * 0.07 : 0,
        spawn: spawn(c.id),
        selectable,
        clickable,
        selected: sel,
        hint: hintBy?.cardIds.includes(c.id) ? hue(hintBy.by) : by && by !== you ? hue(by) : null,
        dim: p.out || (choosing && !selectable && !elevated),
        tone,
        label: seat.me ? `Your card ${i + 1}` : `Card ${i + 1}`,
      });
    });
  });

  const top = game.discard.length - 1;
  game.discard.forEach((c, i) => {
    const j = jitter(c.id);
    const isTop = i === top;
    const selectable = isTop && canSelect(c.id, 'discardTop');
    out.push({
      id: c.id,
      x: L.discard.x + j.dx,
      y: L.discard.y + j.dy,
      rot: j.rot,
      s: L.pileS,
      z: 100 + i,
      faceUp: true,
      face: c.face,
      elevated: false,
      delay: dealing ? deal.size * 0.075 + 0.1 : 0,
      flipDelay: 0,
      spawn: spawn(c.id),
      selectable,
      clickable: selectable,
      selected: false,
      hint: null,
      dim: false,
      tone: null,
      label: isTop ? 'Top of the discard pile' : 'Discard pile',
    });
  });

  const step = game.turn.step;
  if (step.kind === 'drawn') {
    const seat = L.seats.get(game.turn.playerId)!;
    const d = L.drawn(seat);
    out.push({
      id: step.card.id,
      x: d.x,
      y: d.y,
      rot: d.rot,
      s: d.s,
      z: 600,
      faceUp: !!step.card.face,
      face: step.card.face,
      elevated: true,
      delay: 0,
      flipDelay: 0.08,
      spawn: step.from === 'deck' ? spawn(step.card.id) : undefined,
      selectable: false,
      clickable: false,
      selected: false,
      hint: null,
      dim: false,
      tone: null,
      label: seat.me ? 'The card you drew' : 'Drawn card',
    });
  }

  if (step.kind === 'power' && step.joker) {
    const ids = jokerSlots(game);
    const n = ids.length;
    for (const e of step.joker.pool) {
      const slotOwner = step.stage === 'assign' && step.joker.assignment
        ? Object.keys(step.joker.assignment).find((r) => step.joker!.assignment![r] === e.card.id)!
        : e.from;
      const i = ids.indexOf(slotOwner);
      const p = L.pool(i, n);
      const selectable = canSelect(e.card.id, 'pool');
      out.push({
        id: e.card.id,
        x: p.x,
        y: p.y,
        rot: 0,
        s: p.s,
        z: 500 + i,
        faceUp: !!e.card.face,
        face: e.card.face,
        elevated: true,
        delay: 0,
        flipDelay: i * 0.08,
        spawn: undefined,
        selectable,
        clickable: selectable,
        selected: selected.includes(e.card.id),
        hint: null,
        dim: false,
        tone: null,
        label: 'Joker card',
      });
    }
  }
  return out;
}

// ───────────────────────────────────────── controls and call-outs

/** Only what the player has to decide right now. Everything else is shown by the table itself. */
function buildControls(o: { mode: Mode; game: GameView; name: (id: string) => string; onDeck: () => void }): ControlSpec | null {
  const { mode, game, name } = o;
  const step = game.turn.step;
  const rhyme = step.kind === 'power' ? POWERS[step.power].rhyme : '';
  const skip = { label: 'Skip', onClick: () => net.act({ t: 'pass' }), kind: 'link' as const };
  switch (mode.k) {
    case 'memorize':
      return { key: 'memorize', buttons: [{ label: 'Ready', onClick: () => net.act({ t: 'ready' }), kind: 'primary' }] };
    case 'start':
      return game.canCambio
        ? { key: 'cambio', buttons: [{ label: 'Cambio', onClick: () => net.act({ t: 'cambio' }), kind: 'cambio' }] }
        : null;
    case 'give':
      return { key: `give:${mode.to}`, label: `Give ${name(mode.to)} a card`, timer: game.giftMs, buttons: [] };
    case 'jokerPick':
      return { key: 'jokerPick', label: `Hand ${name(mode.from)} a card`, buttons: [] };
    case 'peekOwn':
    case 'peekOther':
    case 'target':
    case 'pickTwo':
    case 'again':
      return { key: `${mode.k}:${rhyme}`, label: rhyme, italic: true, buttons: [skip] };
    case 'decide':
      return {
        key: 'decide',
        label: rhyme,
        italic: true,
        buttons: [
          { label: 'Swap', onClick: () => net.act({ t: 'decide', swap: true }), kind: 'primary' },
          { label: 'Keep', onClick: () => net.act({ t: 'decide', swap: false }), kind: 'ghost' },
        ],
      };
    case 'jokerAssign':
      return {
        key: 'jokerAssign',
        label: 'Joker Poker',
        italic: true,
        buttons: [{ label: 'Deal', onClick: () => net.act({ t: 'jokerDeal' }), kind: 'primary' }],
      };
    case 'watch':
      return { key: 'watch', label: 'Watching', buttons: [] };
    default:
      return null;
  }
}

function calloutFor(e: GameEvent, name: (id: string) => string): { title: string; sub?: string } | null {
  switch (e.type) {
    case 'cambio':
      return { title: 'Cambio', sub: name(e.playerId) };
    case 'cambioCancelled':
      return { title: 'Cambio cancelled', sub: name(e.playerId) };
    case 'out':
      return { title: 'Out', sub: name(e.playerId) };
    case 'skipped':
      return { title: 'Skipped', sub: e.extended ? `${name(e.playerId)} · one more lap` : name(e.playerId) };
    default:
      return null;
  }
}

function playSound(e: GameEvent, you: string, game: GameView) {
  switch (e.type) {
    case 'deal':
      sound.shuffle();
      sound.deal(Math.min(24, game.players.length * 4 + 1), 0.075);
      break;
    case 'draw':
    case 'drawAgain':
      sound.slide(0, 0.8);
      sound.flip(0.12);
      break;
    case 'swap':
      sound.slide();
      sound.slide(0.12, 0.7);
      break;
    case 'discard':
    case 'give':
    case 'jokerGive':
      sound.slide();
      break;
    case 'flip':
      sound.flip();
      if (e.correct.length) sound.good();
      if (e.wrong.length) sound.bad();
      break;
    case 'peek':
      sound.flip();
      break;
    case 'blindSwap':
    case 'lookSwap':
    case 'jokerDeal':
      sound.slide(0, 0.8);
      sound.slide(0.08, 0.8);
      break;
    case 'handSwap':
      for (let i = 0; i < 4; i++) sound.slide(i * 0.06, 0.6);
      break;
    case 'skip':
    case 'skipped':
      sound.whoosh();
      break;
    case 'penalty':
      sound.slide(0, 0.9);
      break;
    case 'out':
      sound.bad();
      break;
    case 'cambio':
    case 'cambioCancelled':
      sound.cambio();
      break;
    case 'reshuffle':
      sound.shuffle();
      break;
    case 'turn':
    case 'begin':
      if (e.playerId === you) sound.chime();
      break;
    case 'roundEnd':
      for (let i = 0; i < Math.min(10, game.players.length * 3); i++) sound.flip(i * 0.09);
      break;
  }
}
