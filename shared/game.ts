import { cardValue, freshDeck, newCardId, powerOf, shuffle, type Card, type PowerKind, type Rank } from './cards';
import type {
  Action,
  CardView,
  GameEvent,
  GameView,
  JokerView,
  PowerStage,
  RoundResults,
  StepView,
} from './protocol';

export const RULES = {
  handSize: 4,
  /** Slots each player may look at before play starts (the row nearest them). */
  initialPeekSlots: [1, 3],
  /** You must hold this many points or fewer to call Cambio. */
  cambioLimit: 3,
  /** A player holding this many cards is out of the round. */
  outAt: 7,
  /** How long a private peek stays face-up. */
  peekMs: 3200,
  /** How long a wrongly flipped card is shown to everyone before it goes back. */
  showcaseMs: 1700,
  /** Pause on a skipped turn so everyone sees it happen. */
  skipPauseMs: 1500,
  lookSwapTimeoutMs: 25_000,
  jokerCollectTimeoutMs: 30_000,
  jokerAssignTimeoutMs: 60_000,
  /** After flipping someone else's card, how long you have to hand them one of yours. */
  giftMs: 6_000,
} as const;

export class GameError extends Error {
  /** Quiet errors are routine (a lost race) and aren't shown to the player. */
  constructor(
    message: string,
    readonly quiet = false,
  ) {
    super(message);
  }
}

/** Schedules `fn` after `ms`; returns a cancel function. */
export type Scheduler = (ms: number, fn: () => void) => () => void;

interface PState {
  id: string;
  slots: (Card | null)[];
  /** Slots held open while their card is away in a Joker pool. */
  reserved: Set<number>;
  skipPending: boolean;
  immune: boolean;
  ready: boolean;
  /** Cards this player may hand over after flipping someone else's (optional, briefly). */
  owes: { to: string; count: number } | null;
  out: boolean;
}

/** The discard everyone may flip onto. The first correct flip claims it for that flipper and that hand. */
interface FlipWindow {
  rank: Rank;
  claim: { by: string; owner: string } | null;
}

interface JokerState {
  waiting: string[];
  pool: { from: string; slot: number; card: Card }[];
  assignment: Record<string, string> | null;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'start' }
  | { kind: 'drawn'; card: Card; from: 'deck' | 'discard' }
  | { kind: 'skipped'; playerId: string; extended: boolean }
  | {
      kind: 'power';
      power: PowerKind;
      stage: PowerStage;
      cardIds: string[];
      joker: JokerState | null;
    };

const TARGET_POWERS: PowerKind[] = ['skip', 'handSwap'];

export class Game {
  readonly players: PState[];
  deck: Card[] = [];
  discard: Card[] = [];
  phase: 'peek' | 'play' | 'reveal' = 'peek';
  turnIdx: number;
  step: Step = { kind: 'idle' };
  caller: string | null = null;
  flipWindow: FlipWindow | null = null;
  peeks: { by: string; cardIds: string[] }[] = [];
  showcase = new Map<string, number>();
  selecting: { by: string; cardIds: string[] } | null = null;
  results: RoundResults | null = null;
  seq = 0;

  private events: GameEvent[] = [];
  private stepToken = 0;
  private showcaseToken = 0;
  private giftTokens = new Map<string, number>();
  private cancels = new Set<() => void>();
  private disposed = false;

  constructor(
    playerIds: string[],
    private readonly opts: {
      firstPlayer: number;
      round: number;
      schedule: Scheduler;
      onChange: () => void;
      deck?: Card[];
    },
  ) {
    if (playerIds.length < 2) throw new GameError('Cambio needs at least two players.');
    this.players = playerIds.map((id) => ({
      id,
      slots: [],
      reserved: new Set(),
      skipPending: false,
      immune: false,
      ready: false,
      owes: null,
      out: false,
    }));
    this.turnIdx = opts.firstPlayer % playerIds.length;
    this.deck = opts.deck ?? freshDeck();
    for (let r = 0; r < RULES.handSize; r++) {
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[(this.turnIdx + i) % this.players.length];
        p.slots.push(this.deck.pop()!);
      }
    }
    // One card starts the discard pile. Nobody can flip onto it.
    this.discard.push(this.deck.pop()!);
    this.emit({ type: 'deal' });
  }

  get round() {
    return this.opts.round;
  }

  get current(): PState {
    return this.players[this.turnIdx];
  }

  dispose() {
    this.disposed = true;
    for (const c of this.cancels) c();
    this.cancels.clear();
  }

  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Every card in play, for invariant checks. */
  allCards(): Card[] {
    const out: Card[] = [...this.deck, ...this.discard];
    for (const p of this.players) for (const c of p.slots) if (c) out.push(c);
    if (this.step.kind === 'drawn') out.push(this.step.card);
    if (this.step.kind === 'power' && this.step.joker) for (const e of this.step.joker.pool) out.push(e.card);
    return out;
  }

  // ───────────────────────────────────────── actions

  act(pid: string, a: Action) {
    const p = this.player(pid);
    if (p.out && a.t !== 'select') throw new GameError('You’re out of this round with seven cards.');
    // Doing anything else lets an unused gift lapse.
    if (p.owes && a.t !== 'give' && a.t !== 'select' && a.t !== 'flip') p.owes = null;
    this.apply(p, a);
    this.refillDeck();
  }

  private apply(p: PState, a: Action) {
    switch (a.t) {
      case 'ready':
        return this.ready(p);
      case 'draw':
        return this.draw(p);
      case 'take':
        return this.take(p);
      case 'cambio':
        return this.callCambio(p);
      case 'swap':
        return this.swapDrawn(p, a.cardId);
      case 'discard':
        return this.discardDrawn(p);
      case 'keep':
        return this.keepDrawn(p);
      case 'peek':
        return this.peek(p, a.cardId);
      case 'pickTwo':
        return this.pickTwo(p, a.a, a.b);
      case 'decide':
        return this.decide(p, a.swap);
      case 'target':
        return this.target(p, a.playerId);
      case 'again':
        return this.again(p);
      case 'pass':
        return this.pass(p);
      case 'jokerPick':
        return this.jokerPick(p, a.cardId);
      case 'jokerArrange':
        return this.jokerArrange(p, a.assignment);
      case 'jokerDeal':
        return this.jokerDeal(p);
      case 'flip':
        return this.flip(p, a.ownerId, a.cardIds);
      case 'give':
        return this.give(p, a.cardIds);
      case 'select':
        return this.select(p, a.cardIds);
    }
  }

  private ready(p: PState) {
    if (this.phase !== 'peek') throw new GameError('The game has already started.');
    p.ready = true;
    if (this.players.every((x) => x.ready)) {
      this.phase = 'play';
      this.emit({ type: 'begin', playerId: this.current.id });
      this.startTurn();
    }
  }

  private draw(p: PState) {
    this.requireStep(p, 'start');
    const card = this.drawCard();
    if (!card) return this.endRound('deck');
    this.setStep({ kind: 'drawn', card, from: 'deck' });
    this.emit({ type: 'draw', playerId: p.id, from: 'deck' });
  }

  private take(p: PState) {
    this.requireStep(p, 'start');
    if (!this.cardCount(p)) throw new GameError('You have no cards to swap with, so draw from the deck.');
    const card = this.discard.pop();
    if (!card) throw new GameError('The discard pile is empty.');
    this.flipWindow = null;
    this.setStep({ kind: 'drawn', card, from: 'discard' });
    this.emit({ type: 'draw', playerId: p.id, from: 'discard' });
  }

  private callCambio(p: PState) {
    this.requireStep(p, 'start');
    if (this.caller) throw new GameError('Cambio has already been called.');
    if (this.score(p) > RULES.cambioLimit) throw new GameError(`You need ${RULES.cambioLimit} or less to call Cambio.`);
    this.caller = p.id;
    this.emit({ type: 'cambio', playerId: p.id });
    this.endTurn();
  }

  private swapDrawn(p: PState, cardId: string) {
    const step = this.requireStep(p, 'drawn');
    const slot = p.slots.findIndex((c) => c?.id === cardId);
    if (slot < 0) throw new GameError('Pick one of your own cards to swap with.');
    const old = p.slots[slot]!;
    p.slots[slot] = step.card;
    this.setStep({ kind: 'idle' });
    this.pushDiscard(old);
    this.emit({ type: 'swap', playerId: p.id, face: old.face });
    this.endTurn();
  }

  private discardDrawn(p: PState) {
    const step = this.requireStep(p, 'drawn');
    if (step.from !== 'deck') throw new GameError('A card taken from the discard pile has to be swapped in.');
    this.setStep({ kind: 'idle' });
    this.pushDiscard(step.card);
    this.emit({ type: 'discard', playerId: p.id, face: step.card.face });
    const power = powerOf(step.card.face);
    if (!power || !this.powerHasTargets(p, power)) return this.endTurn();
    this.emit({ type: 'power', playerId: p.id, power });
    if (power === 'joker') return this.startJoker(p);
    this.setStep({
      kind: 'power',
      power,
      stage: power === 'drawAgain' ? 'offer' : 'choose',
      cardIds: [],
      joker: null,
    });
  }

  /**
   * With an empty hand there's nothing to swap with, so a drawn card may be kept instead. (It was drawn from the
   * deck: taking the top discard needs a card to swap.)
   */
  private keepDrawn(p: PState) {
    const step = this.requireStep(p, 'drawn');
    if (this.cardCount(p)) throw new GameError('Swap it for one of your cards, or discard it.');
    this.setStep({ kind: 'idle' });
    this.placeInHand(p, step.card);
    this.emit({ type: 'keep', playerId: p.id });
    this.endTurn();
  }

  private peek(p: PState, cardId: string) {
    const step = this.requirePower(p, ['peekOwn', 'peekOther'], 'choose');
    const loc = this.locate(cardId);
    if (!loc) throw new GameError('That card is no longer on the table.');
    if (step.power === 'peekOwn' && loc.p !== p) throw new GameError('Peek at one of your own cards.');
    if (step.power === 'peekOther' && loc.p === p) throw new GameError('Peek at someone else’s card.');
    if (loc.p.out) throw new GameError('That hand is out of play.');
    this.peeks.push({ by: p.id, cardIds: [cardId] });
    this.setStep({ ...step, stage: 'viewing', cardIds: [cardId] });
    this.emit({ type: 'peek', playerId: p.id, ownerId: loc.p.id });
    this.later(RULES.peekMs, () => this.finishPeek(p), true);
  }

  private finishPeek(p: PState) {
    this.peeks = this.peeks.filter((x) => x.by !== p.id);
    this.endTurn();
  }

  private pickTwo(p: PState, a: string, b: string) {
    const step = this.requirePower(p, ['blindSwap', 'lookSwap'], 'choose');
    if (a === b) throw new GameError('Pick two different cards.');
    const la = this.locate(a);
    const lb = this.locate(b);
    if (!la || !lb) throw new GameError('That card is no longer on the table.');
    if (la.p.out || lb.p.out) throw new GameError('That hand is out of play.');
    if (this.isLocked(la.p) || this.isLocked(lb.p)) throw new GameError('The Cambio caller’s cards are locked.');
    if (step.power === 'blindSwap') {
      this.swapCards(a, b);
      this.emit({ type: 'blindSwap', playerId: p.id, owners: [la.p.id, lb.p.id] });
      return this.endTurn();
    }
    this.peeks.push({ by: p.id, cardIds: [a, b] });
    this.setStep({ ...step, stage: 'decide', cardIds: [a, b] });
    this.later(RULES.lookSwapTimeoutMs, () => this.decide(p, false), true);
  }

  private decide(p: PState, swap: boolean) {
    const step = this.requirePower(p, ['lookSwap'], 'decide');
    const [a, b] = step.cardIds;
    const la = this.locate(a);
    const lb = this.locate(b);
    const possible = !!la && !!lb && !this.isFrozen(la.p) && !this.isFrozen(lb.p);
    const swapped = swap && possible;
    if (swapped) this.swapCards(a, b);
    this.peeks = this.peeks.filter((x) => x.by !== p.id);
    this.emit({
      type: 'lookSwap',
      playerId: p.id,
      owners: [la?.p.id ?? p.id, lb?.p.id ?? p.id],
      swapped,
    });
    this.endTurn();
  }

  private target(p: PState, targetId: string) {
    const step = this.requirePower(p, TARGET_POWERS, 'choose');
    const t = this.player(targetId);
    if (t === p) throw new GameError('Pick another player.');
    if (t.out) throw new GameError('That player is out of this round.');
    if (step.power === 'skip') {
      if (!this.canSkip(t)) throw new GameError(t.immune ? 'That player is immune this round.' : 'That player is already being skipped.');
      t.skipPending = true;
      this.emit({ type: 'skip', playerId: p.id, target: t.id });
    } else if (this.isLocked(t)) {
      // Start anew on the Cambio caller doesn't trade hands: it cancels their call instead.
      this.caller = null;
      this.emit({ type: 'cambioCancelled', playerId: p.id, target: t.id });
    } else {
      const mine = p.slots;
      p.slots = t.slots;
      t.slots = mine;
      this.emit({ type: 'handSwap', playerId: p.id, target: t.id });
      if (this.checkOut()) return;
    }
    this.endTurn();
  }

  private again(p: PState) {
    this.requirePower(p, ['drawAgain'], 'offer');
    const card = this.drawCard();
    if (!card) return this.endRound('deck');
    this.setStep({ kind: 'drawn', card, from: 'deck' });
    this.emit({ type: 'drawAgain', playerId: p.id });
  }

  private pass(p: PState) {
    if (this.current !== p || this.step.kind !== 'power' || this.phase !== 'play')
      throw new GameError('Nothing to skip right now.');
    const step = this.step;
    if (step.power === 'joker') throw new GameError('The Joker can’t be declined.');
    if (step.stage === 'viewing') return this.finishPeek(p);
    if (step.stage === 'decide') return this.decide(p, false);
    this.emit({ type: 'pass', playerId: p.id, power: step.power });
    this.endTurn();
  }

  // ── Joker Poker

  private startJoker(p: PState) {
    const waiting = this.players.filter((x) => x !== p && !this.isFrozen(x) && this.cardCount(x) > 0).map((x) => x.id);
    this.setStep({
      kind: 'power',
      power: 'joker',
      stage: 'collect',
      cardIds: [],
      joker: { waiting, pool: [], assignment: null },
    });
    this.later(
      RULES.jokerCollectTimeoutMs,
      () => {
        const j = this.jokerState('collect');
        if (!j) return;
        for (const id of [...j.waiting]) {
          const giver = this.player(id);
          const options = giver.slots.filter((c): c is Card => !!c);
          if (options.length) this.jokerPick(giver, options[Math.floor(Math.random() * options.length)].id);
        }
        this.checkJokerCollect();
      },
      true,
    );
  }

  private jokerState(stage: PowerStage): JokerState | null {
    const s = this.step;
    if (this.phase !== 'play' || s.kind !== 'power' || s.power !== 'joker' || s.stage !== stage) return null;
    return s.joker;
  }

  private jokerPick(p: PState, cardId: string) {
    const j = this.jokerState('collect');
    if (!j || !j.waiting.includes(p.id)) throw new GameError('You don’t owe a card to the Joker.');
    const slot = p.slots.findIndex((c) => c?.id === cardId);
    if (slot < 0) throw new GameError('Pick one of your own cards.');
    const card = p.slots[slot]!;
    p.slots[slot] = null;
    p.reserved.add(slot);
    j.pool.push({ from: p.id, slot, card });
    j.waiting = j.waiting.filter((x) => x !== p.id);
    this.emit({ type: 'jokerGive', playerId: p.id, to: this.current.id });
    this.checkJokerCollect();
  }

  /** Moves to dealing once nobody is left to hand a card over. */
  private checkJokerCollect() {
    const j = this.jokerState('collect');
    if (!j) return;
    j.waiting = j.waiting.filter((id) => !this.player(id).out && this.cardCount(this.player(id)) > 0);
    if (j.waiting.length) return;
    const step = this.step as Extract<Step, { kind: 'power' }>;
    if (!j.pool.length) return this.endTurn();
    const assignment: Record<string, string> = {};
    for (const e of j.pool) assignment[e.from] = e.card.id;
    const p = this.current;
    this.peeks.push({ by: p.id, cardIds: j.pool.map((e) => e.card.id) });
    this.setStep({ ...step, stage: 'assign', joker: { ...j, assignment } });
    this.later(RULES.jokerAssignTimeoutMs, () => this.jokerDeal(p), true);
  }

  private jokerArrange(p: PState, assignment: Record<string, string>) {
    const j = this.jokerState('assign');
    if (!j || this.current !== p) throw new GameError('You aren’t dealing a Joker.');
    const from = j.pool.map((e) => e.from).sort();
    const ids = j.pool.map((e) => e.card.id).sort();
    const keys = Object.keys(assignment).sort();
    const vals = Object.values(assignment).sort();
    if (keys.join() !== from.join() || vals.join() !== ids.join())
      throw new GameError('Give each player exactly one of the cards.');
    j.assignment = { ...assignment };
  }

  private jokerDeal(p: PState) {
    const j = this.jokerState('assign');
    if (!j || this.current !== p) throw new GameError('You aren’t dealing a Joker.');
    const assignment = j.assignment!;
    for (const entry of j.pool) {
      const r = this.player(entry.from);
      const card = j.pool.find((e) => e.card.id === assignment[r.id])!.card;
      r.reserved.delete(entry.slot);
      if (r.slots[entry.slot] === null) r.slots[entry.slot] = card;
      else this.placeInHand(r, card);
    }
    j.pool = [];
    this.peeks = this.peeks.filter((x) => x.by !== p.id);
    this.emit({ type: 'jokerDeal', playerId: p.id });
    this.endTurn();
  }

  // ── Flipping

  private flip(p: PState, ownerId: string, cardIds: string[]) {
    if (this.phase !== 'play') throw new GameError('You can’t flip right now.', true);
    const w = this.flipWindow;
    if (!w) throw new GameError('There’s nothing to flip onto.', true);
    if (this.isLocked(p)) throw new GameError('You called Cambio, so your hand is locked.', true);
    const owner = this.player(ownerId);
    if (this.isLocked(owner)) throw new GameError('The Cambio caller’s cards are locked.', true);
    if (owner.out) throw new GameError('That hand is out of play.', true);
    // Once someone flips correctly, only they may keep flipping, and only from that same hand.
    if (w.claim && (w.claim.by !== p.id || w.claim.owner !== owner.id))
      throw new GameError('Too slow. Someone already flipped on that card.', true);
    const ids = [...new Set(cardIds)];
    if (!ids.length) throw new GameError('Pick at least one card to flip.', true);
    const slots = ids.map((id) => owner.slots.findIndex((c) => c?.id === id));
    if (slots.some((s) => s < 0)) throw new GameError('All flipped cards must come from the same hand.', true);

    const correct: Card[] = [];
    const wrong: Card[] = [];
    slots.forEach((s) => {
      const card = owner.slots[s]!;
      (card.face.rank === w.rank ? correct : wrong).push(card);
    });
    for (const c of correct) {
      owner.slots[owner.slots.findIndex((x) => x?.id === c.id)] = null;
      this.discard.push(c);
    }
    if (correct.length && !w.claim) w.claim = { by: p.id, owner: owner.id };
    this.trimSlots(owner);

    if (wrong.length) {
      const token = ++this.showcaseToken;
      for (const c of wrong) this.showcase.set(c.id, token);
      this.later(RULES.showcaseMs, () => {
        for (const c of wrong) if (this.showcase.get(c.id) === token) this.showcase.delete(c.id);
        this.penalty(p, wrong.length);
      });
    }
    if (owner !== p && correct.length && this.cardCount(p) > 0) {
      // You may hand them one of yours for each card you flipped, for a few seconds.
      const prior = p.owes?.to === owner.id ? p.owes.count : 0;
      p.owes = { to: owner.id, count: prior + correct.length };
      const token = (this.giftTokens.get(p.id) ?? 0) + 1;
      this.giftTokens.set(p.id, token);
      this.later(RULES.giftMs, () => {
        if (this.giftTokens.get(p.id) === token) p.owes = null;
      });
    }
    this.emit({
      type: 'flip',
      playerId: p.id,
      ownerId: owner.id,
      rank: w.rank,
      correct: correct.map((c) => c.id),
      wrong: wrong.map((c) => c.id),
    });
    this.checkJokerCollect();
  }

  private give(p: PState, cardIds: string[]) {
    if (!p.owes) throw new GameError('Too late to hand that card over.', true);
    const ids = [...new Set(cardIds)];
    if (!ids.length || ids.length > p.owes.count) throw new GameError(`You can give up to ${p.owes.count}.`, true);
    const to = this.player(p.owes.to);
    for (const id of ids) {
      if (p.slots.findIndex((c) => c?.id === id) < 0) throw new GameError('Give cards from your own hand.', true);
    }
    for (const id of ids) {
      const slot = p.slots.findIndex((c) => c?.id === id);
      const card = p.slots[slot]!;
      p.slots[slot] = null;
      this.placeInHand(to, card);
    }
    this.trimSlots(p);
    p.owes = p.owes.count - ids.length > 0 && this.cardCount(p) > 0 ? { to: to.id, count: p.owes.count - ids.length } : null;
    this.emit({ type: 'give', playerId: p.id, to: to.id, count: ids.length });
    this.checkOut();
  }

  private penalty(p: PState, count: number) {
    if (this.phase !== 'play') return;
    let dealt = 0;
    for (let i = 0; i < count; i++) {
      const card = this.drawCard();
      if (!card) break;
      this.placeInHand(p, card);
      dealt++;
    }
    if (dealt) this.emit({ type: 'penalty', playerId: p.id, count: dealt });
    this.checkOut();
  }

  /**
   * Seven cards and you're out: no more turns, and your hand is frozen. Returns true when this
   * moved the game on (the round ended, or the player whose turn it was went out).
   */
  private checkOut(): boolean {
    if (this.phase !== 'play') return false;
    let currentOut = false;
    for (const p of this.players) {
      if (p.out || this.cardCount(p) < RULES.outAt) continue;
      p.out = true;
      p.owes = null;
      p.skipPending = false;
      this.peeks = this.peeks.filter((x) => x.by !== p.id);
      this.emit({ type: 'out', playerId: p.id });
      if (p === this.current) currentOut = true;
    }
    if (this.players.filter((p) => !p.out).length <= 1) {
      this.endRound('out');
      return true;
    }
    if (currentOut) {
      this.abortStep();
      this.advance();
      return true;
    }
    this.checkJokerCollect();
    return false;
  }

  /** Puts back whatever the current player had in hand mid-turn. */
  private abortStep() {
    const s = this.step;
    // Under the top card, so it opens no new flip.
    if (s.kind === 'drawn') this.discard.splice(Math.max(0, this.discard.length - 1), 0, s.card);
    if (s.kind === 'power' && s.joker) this.returnJokerPool(s.joker);
    this.peeks = this.peeks.filter((x) => x.by !== this.current.id);
    this.setStep({ kind: 'idle' });
  }

  private returnJokerPool(j: JokerState) {
    for (const e of j.pool) {
      const r = this.player(e.from);
      r.reserved.delete(e.slot);
      if (r.slots[e.slot] === null) r.slots[e.slot] = e.card;
      else this.placeInHand(r, e.card);
    }
    j.pool = [];
  }

  private select(p: PState, cardIds: string[]) {
    if (this.current !== p || this.step.kind !== 'power') return;
    this.selecting = { by: p.id, cardIds: cardIds.slice(0, 8) };
  }

  // ───────────────────────────────────────── turn flow

  private startTurn() {
    const p = this.current;
    if (this.caller === p.id) {
      if (p.skipPending && !p.out) return this.skipTurn(p, true);
      return this.endRound('cambio');
    }
    if (p.out) return this.advance();
    if (p.skipPending) return this.skipTurn(p, false);
    this.seq++;
    this.setStep({ kind: 'start' });
    this.emit({ type: 'turn', playerId: p.id });
  }

  private skipTurn(p: PState, extended: boolean) {
    p.skipPending = false;
    p.immune = true;
    this.seq++;
    this.setStep({ kind: 'skipped', playerId: p.id, extended });
    this.emit({ type: 'skipped', playerId: p.id, extended });
    this.later(RULES.skipPauseMs, () => this.advance(), true);
  }

  private endTurn() {
    const p = this.current;
    // Immunity from a skip lasts until the end of the player's next real turn.
    p.immune = false;
    this.peeks = this.peeks.filter((x) => x.by !== p.id);
    this.advance();
  }

  private advance() {
    this.turnIdx = (this.turnIdx + 1) % this.players.length;
    this.startTurn();
  }

  private endRound(reason: 'cambio' | 'deck' | 'out') {
    if (this.phase === 'reveal') return;
    this.phase = 'reveal';
    // Anything mid-flight goes back where it came from so every card can be scored.
    const s = this.step;
    if (s.kind === 'drawn') this.discard.push(s.card);
    if (s.kind === 'power' && s.joker) this.returnJokerPool(s.joker);
    this.setStep({ kind: 'idle' });
    this.peeks = [];
    this.showcase.clear();
    this.flipWindow = null;
    for (const c of this.cancels) c();
    this.cancels.clear();

    const scores: Record<string, number> = {};
    for (const p of this.players) scores[p.id] = this.score(p);
    const points: Record<string, number> = { ...scores };
    // Players who went out can't win.
    const alive = this.players.filter((p) => !p.out);
    const contenders = alive.length ? alive : this.players;
    // Lowest hand wins. A tie goes to whoever holds fewer cards, and if that's level too, against the Cambio caller.
    const byPoints = lowest(contenders, (p) => points[p.id]);
    const byCards = lowest(byPoints, (p) => this.cardCount(p));
    const byCaller = lowest(byCards, (p) => (this.isLocked(p) ? 1 : 0));
    const tiebreak = byCards.length < byPoints.length ? 'cards' : byCaller.length < byCards.length ? 'caller' : null;
    const winners = byCaller.map((p) => p.id);
    const out = this.players.filter((p) => p.out).map((p) => p.id);
    this.results = { scores, points, caller: this.caller, winners, tiebreak, out, reason };
    this.emit({ type: 'roundEnd', results: this.results });
  }

  // ───────────────────────────────────────── helpers

  score(p: PState) {
    return p.slots.reduce((sum, c) => sum + (c ? cardValue(c.face) : 0), 0);
  }

  player(id: string): PState {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new GameError('That player isn’t in this game.');
    return p;
  }

  locate(cardId: string): { p: PState; slot: number } | null {
    for (const p of this.players) {
      const slot = p.slots.findIndex((c) => c?.id === cardId);
      if (slot >= 0) return { p, slot };
    }
    return null;
  }

  cardCount(p: PState) {
    return p.slots.reduce((n, c) => n + (c ? 1 : 0), 0);
  }

  isLocked(p: PState) {
    return this.caller === p.id;
  }

  /** Whether `id` may call Cambio right now. Only ever told to that player. */
  canCambio(id: string) {
    const p = this.players.find((x) => x.id === id);
    return (
      !!p &&
      this.phase === 'play' &&
      this.current === p &&
      this.step.kind === 'start' &&
      !this.caller &&
      !p.out &&
      this.score(p) <= RULES.cambioLimit
    );
  }

  /** Locked by a Cambio call, or out of the round. */
  isFrozen(p: PState) {
    return this.isLocked(p) || p.out;
  }

  canSkip(t: PState) {
    return !t.immune && !t.skipPending && !t.out;
  }

  private powerHasTargets(p: PState, power: PowerKind): boolean {
    const others = this.players.filter((x) => x !== p && !x.out);
    const unlockedCards = this.players.filter((x) => !this.isFrozen(x)).reduce((n, x) => n + this.cardCount(x), 0);
    switch (power) {
      case 'peekOwn':
        return this.cardCount(p) > 0;
      case 'peekOther':
        return others.some((x) => this.cardCount(x) > 0);
      case 'blindSwap':
      case 'lookSwap':
        return unlockedCards >= 2;
      case 'skip':
        return others.some((x) => this.canSkip(x));
      case 'handSwap':
        return others.length > 0;
      case 'joker':
        return others.some((x) => !this.isFrozen(x) && this.cardCount(x) > 0);
      case 'drawAgain':
        return true;
    }
  }

  private swapCards(a: string, b: string) {
    const la = this.locate(a)!;
    const lb = this.locate(b)!;
    const ca = la.p.slots[la.slot];
    la.p.slots[la.slot] = lb.p.slots[lb.slot];
    lb.p.slots[lb.slot] = ca;
  }

  private pushDiscard(c: Card) {
    this.discard.push(c);
    this.flipWindow = { rank: c.face.rank, claim: null };
  }

  private drawCard(): Card | null {
    this.refillDeck();
    return this.deck.pop() ?? null;
  }

  /**
   * Once the deck runs out, the top discard stays where it is and the rest are shuffled into a new deck.
   * Runs after every action and timer, so the table never shows an empty deck while there are discards to reuse.
   */
  private refillDeck() {
    if (this.phase !== 'play' || this.deck.length || this.discard.length < 2) return;
    const top = this.discard.pop()!;
    // Fresh ids so nobody can recognise a reshuffled card by its id.
    this.deck = shuffle(this.discard.map((c) => ({ id: newCardId(), face: c.face })));
    this.discard = [top];
    this.emit({ type: 'reshuffle' });
  }

  private placeInHand(p: PState, card: Card) {
    const idx = p.slots.findIndex((c, i) => c === null && !p.reserved.has(i));
    if (idx >= 0) p.slots[idx] = card;
    else p.slots.push(card);
  }

  /** Drops empty slots off the end of a hand, never shrinking below the starting grid. */
  private trimSlots(p: PState) {
    while (p.slots.length > RULES.handSize && p.slots[p.slots.length - 1] === null && !p.reserved.has(p.slots.length - 1))
      p.slots.pop();
  }

  private requireStep<K extends Step['kind']>(p: PState, kind: K): Extract<Step, { kind: K }> {
    if (this.phase !== 'play') throw new GameError('The round isn’t in play.');
    if (this.current !== p) throw new GameError('It isn’t your turn.');
    if (this.step.kind !== kind) throw new GameError('You can’t do that right now.');
    return this.step as Extract<Step, { kind: K }>;
  }

  private requirePower(p: PState, powers: PowerKind[], stage: PowerStage) {
    const step = this.requireStep(p, 'power');
    if (!powers.includes(step.power) || step.stage !== stage) throw new GameError('You can’t do that right now.');
    return step;
  }

  private setStep(step: Step) {
    this.stepToken++;
    this.step = step;
    this.selecting = null;
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }

  private later(ms: number, fn: () => void, stepScoped = false) {
    const token = this.stepToken;
    const cancel = this.opts.schedule(ms, () => {
      this.cancels.delete(cancel);
      if (this.disposed || this.phase === 'reveal') return;
      if (stepScoped && token !== this.stepToken) return;
      try {
        fn();
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
      }
      this.refillDeck();
      this.opts.onChange();
    });
    this.cancels.add(cancel);
  }

  // ───────────────────────────────────────── views

  private canSee(viewer: string, cardId: string, owner: PState | null, slot: number): boolean {
    if (this.phase === 'reveal') return true;
    if (this.showcase.has(cardId)) return true;
    if (this.peeks.some((x) => x.by === viewer && x.cardIds.includes(cardId))) return true;
    if (this.phase === 'peek' && owner?.id === viewer && !owner.ready) return (RULES.initialPeekSlots as readonly number[]).includes(slot);
    return false;
  }

  private cardView(viewer: string, c: Card, owner: PState | null, slot: number): CardView {
    return this.canSee(viewer, c.id, owner, slot) ? { id: c.id, face: c.face } : { id: c.id };
  }

  private stepView(viewer: string): StepView {
    const s = this.step;
    switch (s.kind) {
      case 'idle':
      case 'start':
        return { kind: s.kind };
      case 'skipped':
        return { ...s };
      case 'drawn':
        return {
          kind: 'drawn',
          from: s.from,
          card: this.current.id === viewer ? { id: s.card.id, face: s.card.face } : { id: s.card.id },
        };
      case 'power': {
        let joker: JokerView | null = null;
        if (s.joker) {
          joker = {
            waiting: [...s.joker.waiting],
            pool: s.joker.pool.map((e) => ({ from: e.from, card: this.cardView(viewer, e.card, null, -1) })),
            assignment: s.joker.assignment ? { ...s.joker.assignment } : null,
          };
        }
        return { kind: 'power', power: s.power, stage: s.stage, cardIds: [...s.cardIds], joker };
      }
    }
  }

  viewFor(viewer: string): GameView {
    return {
      phase: this.phase,
      round: this.round,
      turn: { playerId: this.current.id, step: this.stepView(viewer), seq: this.seq },
      players: this.players.map((p) => ({
        id: p.id,
        slots: p.slots.map((c, i) => (c ? this.cardView(viewer, c, p, i) : null)),
        skipPending: p.skipPending,
        immune: p.immune,
        ready: p.ready,
        owes: p.owes ? { ...p.owes } : null,
        out: p.out,
      })),
      deckCount: this.deck.length,
      discard: this.discard.slice(-6).map((c) => ({ id: c.id, face: c.face })),
      discardCount: this.discard.length,
      flip: {
        open: this.phase === 'play' && !!this.flipWindow,
        rank: this.flipWindow?.rank ?? null,
        claim: this.flipWindow?.claim ? { ...this.flipWindow.claim } : null,
      },
      canCambio: this.canCambio(viewer),
      caller: this.caller,
      peeks: this.peeks.map((x) => ({ by: x.by, cardIds: [...x.cardIds] })),
      showcase: [...this.showcase.keys()],
      selecting: this.selecting,
      initialPeekSlots: [...RULES.initialPeekSlots],
      results: this.results,
      cambioLimit: RULES.cambioLimit,
      outAt: RULES.outAt,
      giftMs: RULES.giftMs,
    };
  }
}

/** The players with the lowest `key`. */
function lowest(ps: PState[], key: (p: PState) => number): PState[] {
  const best = Math.min(...ps.map(key));
  return ps.filter((p) => key(p) === best);
}
