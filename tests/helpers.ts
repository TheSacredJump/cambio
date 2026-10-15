import type { Card, Face, Rank, Suit } from '../shared/cards';
import { Game } from '../shared/game';

/** Deterministic virtual time for timers and bots. */
export class VirtualClock {
  now = 0;
  private seq = 0;
  private queue: { at: number; seq: number; fn: () => void; cancelled: boolean }[] = [];

  schedule = (ms: number, fn: () => void) => {
    const t = { at: this.now + ms, seq: this.seq++, fn, cancelled: false };
    this.queue.push(t);
    return () => {
      t.cancelled = true;
    };
  };

  /** Fires the next timer. Returns false when nothing is left. */
  async step(): Promise<boolean> {
    await flushMicrotasks();
    this.queue = this.queue.filter((t) => !t.cancelled);
    if (!this.queue.length) return false;
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    const t = this.queue.shift()!;
    this.now = Math.max(this.now, t.at);
    t.fn();
    await flushMicrotasks();
    return true;
  }

  async advance(ms: number) {
    const until = this.now + ms;
    for (;;) {
      await flushMicrotasks();
      const next = this.queue.filter((t) => !t.cancelled).sort((a, b) => a.at - b.at)[0];
      if (!next || next.at > until) break;
      await this.step();
    }
    this.now = until;
  }
}

export async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

let n = 0;
export const f = (rank: Rank, suit: Suit = 'S'): Face => ({ rank, suit });

/**
 * Builds a game whose hands are exactly `hands` (slot order), with `discardTop` face-up
 * and `rest` on top of the draw pile (rest[0] drawn first).
 */
export function rigged(hands: Face[][], opts: { discardTop?: Face; rest?: Face[]; clock?: VirtualClock } = {}) {
  const clock = opts.clock ?? new VirtualClock();
  const ids = hands.map((_, i) => `P${i}`);
  // Deal order is round-robin from the end of the deck array.
  const dealOrder: Face[] = [];
  for (let r = 0; r < 4; r++) for (let p = 0; p < hands.length; p++) dealOrder.push(hands[p][r]);
  const draws = [...(opts.rest ?? [])];
  const filler: Face[] = Array.from({ length: 20 }, () => f('9', 'C'));
  const sequence = [...dealOrder, opts.discardTop ?? f('K', 'H'), ...draws, ...filler];
  const deck: Card[] = sequence.reverse().map((face) => ({ id: `c${n++}`, face }));
  const game = new Game(ids, { firstPlayer: 0, round: 1, schedule: clock.schedule, onChange: () => {}, deck });
  for (const id of ids) game.act(id, { t: 'ready' });
  game.drainEvents();
  const card = (player: number, slot: number) => game.players[player].slots[slot]!.id;
  return { game, clock, ids, card };
}
