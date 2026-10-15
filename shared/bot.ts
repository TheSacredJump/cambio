import { cardValue, powerOf, type Face } from './cards';
import type { Action, CardView, GameView, PlayerView } from './protocol';

export interface BotDecision {
  /** Identifies the situation; the room only reschedules when this changes. */
  key: string;
  action: Action;
  delay: number;
}

/** Average card value: A=1 … 10, J=11, Q=12, black K=13, red K=-1, Joker=0. */
const AVG_UNKNOWN = 6.2;
const jitter = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * A modest player with a decent memory. It sees exactly what a human in its seat would see,
 * and remembers every face it has been shown by card id.
 */
export class BotBrain {
  private memory = new Map<string, Face>();

  constructor(
    readonly id: string,
    /** 0..1. Lower skill reacts slower and sometimes misses a flip. */
    readonly skill = 0.8,
  ) {}

  observe(view: GameView) {
    const see = (c: CardView | null | undefined) => {
      if (c?.face) this.memory.set(c.id, c.face);
    };
    for (const p of view.players) p.slots.forEach(see);
    const step = view.turn.step;
    if (step.kind === 'drawn') see(step.card);
    if (step.kind === 'power' && step.joker) step.joker.pool.forEach((e) => see(e.card));
  }

  forget() {
    this.memory.clear();
  }

  // ───────────────────────────── helpers

  private face(id: string) {
    return this.memory.get(id);
  }

  private me(view: GameView) {
    return view.players.find((p) => p.id === this.id)!;
  }

  private cards(p: PlayerView) {
    return p.slots.filter((c): c is CardView => !!c);
  }

  private known(p: PlayerView) {
    return this.cards(p)
      .filter((c) => this.face(c.id))
      .map((c) => ({ id: c.id, value: cardValue(this.face(c.id)!) }));
  }

  private unknown(p: PlayerView) {
    return this.cards(p).filter((c) => !this.face(c.id));
  }

  private estimate(p: PlayerView) {
    return this.known(p).reduce((s, k) => s + k.value, 0) + this.unknown(p).length * AVG_UNKNOWN;
  }

  private worstKnown(p: PlayerView) {
    return this.known(p).sort((a, b) => b.value - a.value)[0] ?? null;
  }

  private pick<T>(xs: T[]): T | undefined {
    return xs[Math.floor(Math.random() * xs.length)];
  }

  private opponents(view: GameView, unlockedOnly = false) {
    return view.players.filter((p) => p.id !== this.id && !p.out && (!unlockedOnly || p.id !== view.caller));
  }

  /** The opponent who looks closest to winning. */
  private leader(ps: PlayerView[]) {
    return [...ps].sort((a, b) => this.estimate(a) - this.estimate(b))[0];
  }

  /** Cards to hand over: worst known first, then unknown. */
  private worstFirst(p: PlayerView) {
    const known = this.known(p).sort((a, b) => b.value - a.value).map((k) => k.id);
    return [...known.filter((id) => (this.face(id) ? cardValue(this.face(id)!) >= 5 : false)), ...this.unknown(p).map((c) => c.id), ...known.filter((id) => cardValue(this.face(id)!) < 5)];
  }

  // ───────────────────────────── decisions

  /** What to do about the flow of the game (my turn, or input someone is waiting on). */
  decide(view: GameView): BotDecision | null {
    const me = this.me(view);
    if (!me || me.out) return null;
    const step = view.turn.step;

    if (view.phase === 'peek') {
      return me.ready ? null : { key: `ready:${view.round}`, action: { t: 'ready' }, delay: jitter(1400, 2600) };
    }
    if (view.phase !== 'play') return null;

    if (me.owes) {
      // Handing over a card is optional: only part with one that isn't already helping.
      const id = this.worstFirst(me)[0];
      const f = id ? this.face(id) : undefined;
      if (id && (!f || cardValue(f) >= 4))
        return { key: `give:${me.owes.to}:${me.owes.count}:${id}`, action: { t: 'give', cardIds: [id] }, delay: jitter(500, 1100) };
    }

    if (step.kind === 'power' && step.power === 'joker' && step.stage === 'collect' && step.joker?.waiting.includes(this.id)) {
      const id = this.worstFirst(me)[0];
      if (id) return { key: `jokerPick:${view.turn.seq}`, action: { t: 'jokerPick', cardId: id }, delay: jitter(900, 1800) };
    }

    if (view.turn.playerId !== this.id) return null;
    const k = (s: string) => `${view.turn.seq}:${s}`;

    switch (step.kind) {
      case 'start':
        return { key: k('start'), action: this.startAction(view, me), delay: jitter(900, 1600) };
      case 'drawn':
        return { key: k(`drawn:${step.card.id}`), action: this.drawnAction(step, me), delay: jitter(1000, 1700) };
      case 'power':
        return this.powerDecision(view, me, step, k);
      default:
        return null;
    }
  }

  private startAction(view: GameView, me: PlayerView): Action {
    if (view.canCambio) return { t: 'cambio' };
    const top = view.discard[view.discard.length - 1];
    if (top?.face && this.cards(me).length) {
      const v = cardValue(top.face);
      const worst = this.worstKnown(me);
      if (v <= 1 || (worst && worst.value - v >= 5)) return { t: 'take' };
    }
    return { t: 'draw' };
  }

  private drawnAction(step: { card: CardView; from: 'deck' | 'discard' }, me: PlayerView): Action {
    const face = step.card.face!;
    const v = cardValue(face);
    const worst = this.worstKnown(me);
    const unknown = this.unknown(me);
    const swapInto = (id: string): Action => ({ t: 'swap', cardId: id });

    if (step.from === 'discard') {
      if (worst && worst.value > v) return swapInto(worst.id);
      const u = this.pick(unknown);
      return swapInto(u?.id ?? worst?.id ?? this.cards(me)[0].id);
    }
    // Jokers and Aces/Twos are worth keeping, but their powers are too much fun to always hoard.
    if (face.rank === 'JK' && Math.random() < 0.45) return { t: 'discard' };
    if ((face.rank === 'A' || face.rank === '2') && Math.random() < 0.2) return { t: 'discard' };
    if (worst && worst.value >= v + 3) return swapInto(worst.id);
    if (v <= 3 && unknown.length) return swapInto(this.pick(unknown)!.id);
    if (v <= 2 && worst && worst.value > v) return swapInto(worst.id);
    if (!this.cards(me).length) return { t: 'discard' };
    if (!powerOf(face) && worst && worst.value > v) return swapInto(worst.id);
    return { t: 'discard' };
  }

  private powerDecision(
    view: GameView,
    me: PlayerView,
    step: Extract<GameView['turn']['step'], { kind: 'power' }>,
    k: (s: string) => string,
  ): BotDecision | null {
    const go = (action: Action, delay = jitter(1000, 1800)): BotDecision => ({
      key: k(`${step.power}:${step.stage}:${JSON.stringify(action)}`),
      action,
      delay,
    });
    const pass = () => go({ t: 'pass' }, jitter(700, 1200));
    const opps = this.opponents(view, true);

    switch (step.power) {
      case 'peekOwn': {
        if (step.stage === 'viewing') return go({ t: 'pass' }, jitter(1200, 1800));
        const u = this.pick(this.unknown(me));
        return u ? go({ t: 'peek', cardId: u.id }) : pass();
      }
      case 'peekOther': {
        if (step.stage === 'viewing') return go({ t: 'pass' }, jitter(1200, 1800));
        const target = this.leader(this.opponents(view).filter((p) => this.unknown(p).length));
        const u = target && this.pick(this.unknown(target));
        return u ? go({ t: 'peek', cardId: u.id }) : pass();
      }
      case 'blindSwap': {
        const worst = this.worstKnown(me);
        if (!worst || worst.value < 7 || !opps.length) return pass();
        const lowKnown = opps
          .flatMap((p) => this.known(p))
          .filter((x) => x.value < worst.value - 2)
          .sort((a, b) => a.value - b.value)[0];
        const target = lowKnown?.id ?? this.pick(this.unknown(this.leader(opps)) ?? [])?.id;
        return target ? go({ t: 'pickTwo', a: worst.id, b: target }) : pass();
      }
      case 'lookSwap': {
        if (step.stage === 'decide') {
          const [a, b] = step.cardIds;
          const fa = this.face(a);
          const fb = this.face(b);
          const mineA = me.slots.some((c) => c?.id === a);
          const mineB = me.slots.some((c) => c?.id === b);
          let swap = false;
          if (fa && fb && mineA !== mineB) {
            const mine = cardValue(mineA ? fa : fb);
            const theirs = cardValue(mineA ? fb : fa);
            swap = theirs < mine;
          }
          return go({ t: 'decide', swap }, jitter(1400, 2200));
        }
        const worst = this.worstKnown(me);
        const ownPick = worst && worst.value >= 6 ? worst.id : this.pick(this.unknown(me))?.id ?? worst?.id;
        const target = opps.length ? this.leader(opps) : null;
        const theirs = target && (this.pick(this.unknown(target)) ?? this.pick(this.cards(target)));
        return ownPick && theirs ? go({ t: 'pickTwo', a: ownPick, b: theirs.id }) : pass();
      }
      case 'skip': {
        const skippable = this.opponents(view).filter((p) => !p.immune && !p.skipPending);
        const caller = view.caller ? skippable.find((p) => p.id === view.caller) : undefined;
        const target = caller ?? (skippable.length ? this.leader(skippable) : undefined);
        return target ? go({ t: 'target', playerId: target.id }) : pass();
      }
      case 'handSwap': {
        const mine = this.estimate(me);
        const caller = view.players.find((p) => p.id === view.caller);
        if (caller && caller.id !== this.id) return go({ t: 'target', playerId: caller.id });
        const best = opps.length ? this.leader(opps) : undefined;
        return best && this.estimate(best) < mine - 6 ? go({ t: 'target', playerId: best.id }) : pass();
      }
      case 'drawAgain':
        return go({ t: 'again' }, jitter(600, 1100));
      case 'joker': {
        if (step.stage !== 'assign' || !step.joker?.assignment) return null;
        const pool = step.joker.pool;
        const recipients = view.players
          .filter((p) => pool.some((e) => e.from === p.id))
          .sort((a, b) => this.estimate(a) - this.estimate(b));
        const cards = [...pool].sort((a, b) => cardValue(b.card.face ?? { rank: '5', suit: 'S' }) - cardValue(a.card.face ?? { rank: '5', suit: 'S' }));
        const want: Record<string, string> = {};
        recipients.forEach((r, i) => (want[r.id] = cards[i].card.id));
        const same = Object.entries(want).every(([r, c]) => step.joker!.assignment![r] === c);
        return same ? go({ t: 'jokerDeal' }, jitter(1000, 1600)) : go({ t: 'jokerArrange', assignment: want }, jitter(1500, 2400));
      }
    }
  }

  /** Whether to flip onto the discard pile right now. */
  decideFlip(view: GameView): BotDecision | null {
    if (view.phase !== 'play' || !view.flip.open || !view.flip.rank) return null;
    const me = this.me(view);
    if (!me || me.out || view.caller === this.id) return null;
    const top = view.discard[view.discard.length - 1];
    if (!top) return null;
    const rank = view.flip.rank;
    const matches = (p: PlayerView) => this.cards(p).filter((c) => this.face(c.id)?.rank === rank).map((c) => c.id);
    const delay = jitter(900, 2400) / Math.max(0.3, this.skill);
    const key = `flip:${top.id}`;
    const claim = view.flip.claim;
    if (claim) {
      // Someone already flipped on this card. Only they may carry on, from the same hand.
      if (claim.by !== this.id) return null;
      const owner = view.players.find((p) => p.id === claim.owner);
      const more = owner ? matches(owner) : [];
      return more.length ? { key, action: { t: 'flip', ownerId: claim.owner, cardIds: more }, delay: jitter(350, 800) } : null;
    }

    const mine = matches(me);
    if (mine.length) {
      if (Math.random() > 0.55 + this.skill * 0.45) return null;
      return { key, action: { t: 'flip', ownerId: this.id, cardIds: mine }, delay };
    }
    if (!this.cards(me).length) return null;
    // Now and then a bot misremembers and flips a card it only thinks matches.
    const guess = this.pick(this.unknown(me));
    if (guess && this.cards(me).length < view.outAt - 2 && Math.random() < 0.06 * (1.2 - this.skill)) {
      return { key, action: { t: 'flip', ownerId: this.id, cardIds: [guess.id] }, delay };
    }
    const theirs = this.opponents(view, true)
      .map((p) => ({ p, ids: matches(p) }))
      .filter((x) => x.ids.length)
      .sort((a, b) => b.ids.length - a.ids.length)[0];
    if (!theirs || Math.random() > this.skill * 0.8) return null;
    return { key, action: { t: 'flip', ownerId: theirs.p.id, cardIds: theirs.ids }, delay: delay + 400 };
  }
}
