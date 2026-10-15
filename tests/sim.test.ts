import { describe, expect, it } from 'vitest';
import type { ServerMsg } from '../shared/protocol';
import { Room } from '../shared/room';
import { VirtualClock } from './helpers';

async function playRound(players: number, seed: number) {
  const clock = new VirtualClock();
  const room = new Room('TEST', clock.schedule);
  const host = room.join('Host', 'tok' + seed);
  const inbox: ServerMsg[] = [];
  room.connect(host.id, (m) => inbox.push(m));
  for (let i = 1; i < players; i++) room.handle(host.id, { t: 'addBot' });
  room.handle(host.id, { t: 'start' });
  // The host hands their seat to the autopilot, so every seat is played by a bot.
  room.handle(host.id, { t: 'leave' });

  const stats = { flips: 0, wrongFlips: 0, powers: {} as Record<string, number>, cambio: 0, cancelled: 0, skipsExtended: 0 };
  let steps = 0;
  while (room.game && room.game.phase !== 'reveal') {
    const ok = await clock.step();
    const game = room.game;
    const cards = game.allCards();
    expect(cards.length).toBe(54);
    expect(new Set(cards.map((c) => c.id)).size).toBe(54);
    if (!ok) throw new Error(`stalled in ${JSON.stringify(game.viewFor(game.players[0].id).turn)}`);
    if (++steps > 20_000 || clock.now > 3_600_000) throw new Error('round never ended');
  }
  return { room, stats, steps, time: clock.now, inbox };
}

describe('bot simulation', () => {
  it('plays hundreds of rounds at every table size without losing a card', async () => {
    const outcomes: Record<string, number> = { cambio: 0, deck: 0, out: 0 };
    for (let i = 0; i < 280; i++) {
      const players = 2 + (i % 7);
      const { room } = await playRound(players, i);
      const r = room.game!.results!;
      outcomes[r.reason]++;
      expect(r.winners.length).toBeGreaterThan(0);
      expect(room.roundsPlayed).toBe(1);
    }
    expect(outcomes.cambio).toBeGreaterThan(200);
    console.log('outcomes', outcomes);
  });
});
