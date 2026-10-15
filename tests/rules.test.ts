import { describe, expect, it } from 'vitest';
import { cardValue } from '../shared/cards';
import { GameError, RULES } from '../shared/game';
import { f, rigged } from './helpers';

const handA = [f('2'), f('7'), f('2', 'H'), f('9')];
const handB = [f('5'), f('2', 'D'), f('Q'), f('K', 'H')];
const handC = [f('3'), f('4'), f('8'), f('10')];

describe('card values', () => {
  it('scores J 11, Q 12, black K 13, red K -1, Joker 0', () => {
    expect(cardValue(f('J', 'C'))).toBe(11);
    expect(cardValue(f('Q', 'D'))).toBe(12);
    expect(cardValue(f('K', 'S'))).toBe(13);
    expect(cardValue(f('K', 'C'))).toBe(13);
    expect(cardValue(f('K', 'H'))).toBe(-1);
    expect(cardValue(f('K', 'D'))).toBe(-1);
    expect(cardValue(f('JK', 'H'))).toBe(0);
    expect(cardValue(f('A', 'C'))).toBe(1);
    expect(cardValue(f('10', 'C'))).toBe(10);
  });
});

describe('flipping', () => {
  it('lets the discarder flip onto their own discard, several cards from one hand at once', () => {
    const { game, ids, card } = rigged([handA, handB], { rest: [f('2', 'C')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' }); // a 2: start anew power
    game.act(ids[0], { t: 'flip', ownerId: ids[0], cardIds: [card(0, 0), card(0, 2)] });
    expect(game.players[0].slots.filter(Boolean)).toHaveLength(2);
    expect(game.discard.slice(-3).map((c) => c.face.rank)).toEqual(['2', '2', '2']);
  });

  it('flips another player’s cards one click at a time, and may give one back for each', () => {
    const twos = [f('5'), f('2', 'D'), f('2', 'C'), f('K', 'H')];
    const { game, ids, card } = rigged([handA, twos, handC], { rest: [f('2', 'S')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    const [b1, b2] = [card(1, 1), card(1, 2)];
    const [give1, give2] = [card(0, 1), card(0, 3)];
    game.act(ids[0], { t: 'flip', ownerId: ids[1], cardIds: [b1] });
    // The first correct flip claims this discard: only A may continue, and only from B's hand.
    expect(() => game.act(ids[2], { t: 'flip', ownerId: ids[2], cardIds: [card(2, 0)] })).toThrow(/Too slow/);
    expect(() => game.act(ids[0], { t: 'flip', ownerId: ids[0], cardIds: [card(0, 0)] })).toThrow(/Too slow/);
    game.act(ids[0], { t: 'flip', ownerId: ids[1], cardIds: [b2] });
    expect(game.players[0].owes).toEqual({ to: ids[1], count: 2 });
    game.act(ids[0], { t: 'give', cardIds: [give1] });
    expect(game.players[0].owes).toEqual({ to: ids[1], count: 1 });
    game.act(ids[0], { t: 'give', cardIds: [give2] });
    expect(game.players[1].slots.map((c) => c?.id)).toEqual(expect.arrayContaining([give1, give2]));
    expect(game.players[0].owes).toBeNull();
  });

  it('giving is optional: the chance lapses after a few seconds, or when you do something else', async () => {
    const { game, ids, card, clock } = rigged([handA, handB], { rest: [f('Q', 'H'), f('K', 'S')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' }); // Q♥ on top, A holds the J/Q power
    game.act(ids[1], { t: 'flip', ownerId: ids[0], cardIds: [card(0, 1)] }); // wrong (7): no gift
    expect(game.players[1].owes).toBeNull();
    game.act(ids[0], { t: 'pass' });
    game.act(ids[1], { t: 'flip', ownerId: ids[1], cardIds: [card(1, 2)] }); // B's own Q: no gift
    expect(game.players[1].owes).toBeNull();
    await clock.advance(RULES.giftMs + RULES.showcaseMs);
    expect(game.players[1].slots.filter(Boolean)).toHaveLength(3 + 1);
  });

  it('only a caller holding 3 or less can call Cambio, and only they are told', () => {
    const low = [f('A'), f('2'), f('K', 'H'), f('JK')]; // 2
    const { game, ids } = rigged([handA, low], { rest: [f('8', 'C')] });
    expect(game.viewFor(ids[0]).canCambio).toBe(false); // 20 points
    expect(() => game.act(ids[0], { t: 'cambio' })).toThrow(/3 or less/);
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    game.act(ids[0], { t: 'pass' });
    expect(game.viewFor(ids[1]).canCambio).toBe(true);
    expect(game.viewFor(ids[0]).canCambio).toBe(false);
    game.act(ids[1], { t: 'cambio' });
    expect(game.caller).toBe(ids[1]);
  });

  it('allows only one successful flip per discard', () => {
    const { game, ids, card } = rigged([handA, handB, handC], { rest: [f('8', 'S')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'swap', cardId: card(0, 1) }); // A discards the 7
    game.act(ids[1], { t: 'draw' });
    game.act(ids[1], { t: 'swap', cardId: card(1, 1) }); // B discards the 2♦
    game.act(ids[0], { t: 'flip', ownerId: ids[0], cardIds: [card(0, 0)] });
    expect(() => game.act(ids[2], { t: 'flip', ownerId: ids[0], cardIds: [card(0, 2)] })).toThrow(/Too slow/);
  });

  it('cannot mix hands in one flip', () => {
    const { game, ids, card } = rigged([handA, handB], { rest: [f('2', 'S')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    expect(() => game.act(ids[0], { t: 'flip', ownerId: ids[0], cardIds: [card(0, 0), card(1, 1)] })).toThrow(
      /same hand/,
    );
  });

  it('a wrong flip shows the card to everyone, returns it, and deals one penalty card per wrong card', async () => {
    const { game, ids, card, clock } = rigged([handA, handB], { rest: [f('7', 'D')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'swap', cardId: card(0, 3) }); // discards the 9
    const before = game.players[1].slots.filter(Boolean).length;
    game.act(ids[1], { t: 'flip', ownerId: ids[1], cardIds: [card(1, 0), card(1, 1)] }); // 5 and 2: both wrong
    expect(game.showcase.size).toBe(2);
    expect(game.viewFor(ids[0]).players[1].slots[0]!.face).toBeDefined();
    await clock.advance(RULES.showcaseMs + 10);
    expect(game.showcase.size).toBe(0);
    expect(game.players[1].slots.filter(Boolean).length).toBe(before + 2);
  });

  it('flipping someone else’s card correctly means handing them one of yours', () => {
    const { game, ids, card } = rigged([handA, handB], { rest: [f('Q', 'H')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' }); // Q♥ on top
    const q = card(1, 2);
    const seven = card(0, 1);
    game.act(ids[0], { t: 'flip', ownerId: ids[1], cardIds: [q] });
    expect(game.players[1].slots[2]).toBeNull();
    expect(game.players[0].owes).toEqual({ to: ids[1], count: 1 });
    expect(() => game.act(ids[1], { t: 'flip', ownerId: ids[1], cardIds: [card(1, 0)] })).toThrow(/Too slow/);
    game.act(ids[0], { t: 'give', cardIds: [seven] });
    expect(game.players[1].slots[2]!.id).toBe(seven);
    expect(game.players[0].slots[1]).toBeNull();
  });
});

describe('powers', () => {
  it('5/6 skips a player once, and they are immune until their next turn ends', async () => {
    const { game, ids, card, clock } = rigged([handA, handB, handC], { rest: [f('5', 'H'), f('6', 'H')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    game.act(ids[0], { t: 'target', playerId: ids[1] });
    expect(game.step.kind).toBe('skipped');
    await clock.advance(RULES.skipPauseMs + 10);
    expect(game.current.id).toBe(ids[2]);
    expect(game.players[1].immune).toBe(true);
    game.act(ids[2], { t: 'draw' });
    game.act(ids[2], { t: 'discard' }); // 6: skip power
    expect(() => game.act(ids[2], { t: 'target', playerId: ids[1] })).toThrow(/immune/);
    game.act(ids[2], { t: 'pass' });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'swap', cardId: card(0, 0) });
    expect(game.current.id).toBe(ids[1]);
    game.act(ids[1], { t: 'draw' });
    game.act(ids[1], { t: 'swap', cardId: card(1, 0) });
    expect(game.players[1].immune).toBe(false);
  });

  it('skipping the Cambio caller gives everyone another lap', async () => {
    const low = [f('A'), f('K', 'H'), f('A', 'H'), f('JK')];
    const { game, ids, clock } = rigged([low, handB, handC], { rest: [f('9', 'D'), f('5', 'S'), f('9', 'H'), f('9', 'S')] });
    game.act(ids[0], { t: 'cambio' });
    game.act(ids[1], { t: 'draw' });
    game.act(ids[1], { t: 'discard' }); // 9♦: peek other
    game.act(ids[1], { t: 'pass' });
    game.act(ids[2], { t: 'draw' });
    game.act(ids[2], { t: 'discard' }); // 5♠: skip the caller
    game.act(ids[2], { t: 'target', playerId: ids[0] });
    expect(game.step).toMatchObject({ kind: 'skipped', extended: true });
    await clock.advance(RULES.skipPauseMs + 10);
    expect(game.phase).toBe('play');
    expect(game.current.id).toBe(ids[1]);
    game.act(ids[1], { t: 'draw' });
    game.act(ids[1], { t: 'discard' });
    game.act(ids[1], { t: 'pass' });
    game.act(ids[2], { t: 'draw' });
    game.act(ids[2], { t: 'discard' });
    game.act(ids[2], { t: 'pass' });
    expect(game.phase).toBe('reveal');
    expect(game.results!.winners).toEqual([ids[0]]);
  });

  it('A/2 played on the Cambio caller cancels the call instead of swapping', () => {
    const low = [f('A'), f('K', 'H'), f('A', 'H'), f('JK')];
    const { game, ids } = rigged([low, handB], { rest: [f('A', 'D')] });
    const callerCards = game.players[0].slots.map((c) => c!.id);
    game.act(ids[0], { t: 'cambio' });
    game.act(ids[1], { t: 'draw' });
    game.act(ids[1], { t: 'discard' });
    game.act(ids[1], { t: 'target', playerId: ids[0] });
    expect(game.caller).toBeNull();
    expect(game.players[0].slots.map((c) => c!.id)).toEqual(callerCards);
    expect(game.phase).toBe('play');
    expect(game.current.id).toBe(ids[0]);
    game.act(ids[0], { t: 'cambio' });
    expect(game.caller).toBe(ids[0]);
  });

  it('A/2 trades whole hands blind with a normal player', () => {
    const { game, ids } = rigged([handA, handB], { rest: [f('2', 'C')] });
    const a = game.players[0].slots.map((c) => c!.id);
    const b = game.players[1].slots.map((c) => c!.id);
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    game.act(ids[0], { t: 'target', playerId: ids[1] });
    expect(game.players[0].slots.map((c) => c!.id)).toEqual(b);
    expect(game.players[1].slots.map((c) => c!.id)).toEqual(a);
  });

  it('3/4 draws again', () => {
    const { game, ids } = rigged([handA, handB], { rest: [f('3', 'C'), f('8', 'C')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    game.act(ids[0], { t: 'again' });
    expect(game.step.kind).toBe('drawn');
    game.act(ids[0], { t: 'discard' }); // 8: know your fate
    expect(game.step).toMatchObject({ kind: 'power', power: 'peekOwn' });
  });

  it('7/8 shows only the peeker their card', () => {
    const { game, ids, card } = rigged([handA, handB], { rest: [f('7', 'C')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    game.act(ids[0], { t: 'peek', cardId: card(0, 0) });
    expect(game.viewFor(ids[0]).players[0].slots[0]!.face).toEqual(f('2'));
    expect(game.viewFor(ids[1]).players[0].slots[0]!.face).toBeUndefined();
    expect(() => game.act(ids[0], { t: 'peek', cardId: card(1, 0) })).toThrow(GameError);
  });

  it('black K looks at two cards and swaps on request; J/Q swaps blind', () => {
    const { game, ids, card } = rigged([handA, handB], { rest: [f('K', 'S'), f('J', 'S')] });
    const a = card(0, 3);
    const b = card(1, 3);
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    game.act(ids[0], { t: 'pickTwo', a, b });
    expect(game.viewFor(ids[0]).players[1].slots[3]!.face).toEqual(f('K', 'H'));
    game.act(ids[0], { t: 'decide', swap: true });
    expect(game.players[0].slots[3]!.id).toBe(b);
    game.act(ids[1], { t: 'draw' });
    game.act(ids[1], { t: 'discard' });
    game.act(ids[1], { t: 'pickTwo', a: card(0, 0), b: card(1, 0) });
    expect(game.viewFor(ids[1]).players[0].slots[0]!.face).toBeUndefined();
  });

  it('Joker Poker: everyone hands over a card and the Joker player deals them back', () => {
    const { game, ids, card } = rigged([handA, handB, handC], { rest: [f('JK', 'S')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    expect(() => game.act(ids[0], { t: 'pass' })).toThrow();
    const b2 = card(1, 2);
    const c3 = card(2, 3);
    game.act(ids[1], { t: 'jokerPick', cardId: b2 });
    game.act(ids[2], { t: 'jokerPick', cardId: c3 });
    const view = game.viewFor(ids[0]);
    expect(view.turn.step).toMatchObject({ kind: 'power', stage: 'assign' });
    const pool = (view.turn.step as { joker: { pool: { card: { face?: unknown } }[] } }).joker.pool;
    expect(pool.every((e) => e.card.face)).toBe(true);
    expect(() => game.act(ids[1], { t: 'jokerDeal' })).toThrow();
    game.act(ids[0], { t: 'jokerArrange', assignment: { [ids[1]]: c3, [ids[2]]: b2 } });
    game.act(ids[0], { t: 'jokerDeal' });
    expect(game.players[1].slots[2]!.id).toBe(c3);
    expect(game.players[2].slots[3]!.id).toBe(b2);
    expect(game.current.id).toBe(ids[1]);
  });

  it('the caller’s hand is locked against swaps and flips', () => {
    const low = [f('A'), f('K', 'H'), f('A', 'H'), f('JK')];
    const { game, ids, card } = rigged([low, handB], { rest: [f('J', 'D')] });
    game.act(ids[0], { t: 'cambio' });
    game.act(ids[1], { t: 'draw' });
    game.act(ids[1], { t: 'discard' });
    expect(() => game.act(ids[1], { t: 'pickTwo', a: card(0, 0), b: card(1, 0) })).toThrow(/locked/);
  });
});

describe('calling Cambio', () => {
  it('a caller at 3 or under is safe and wins if lowest', () => {
    const low = [f('A'), f('2'), f('K', 'H'), f('JK')]; // 1 + 2 - 1 + 0 = 2
    const { game, ids } = rigged([low, handB], { rest: [f('8', 'C')] });
    game.act(ids[0], { t: 'cambio' });
    game.act(ids[1], { t: 'draw' });
    game.act(ids[1], { t: 'discard' });
    game.act(ids[1], { t: 'pass' });
    expect(game.results).toMatchObject({ caller: ids[0], winners: [ids[0]] });
  });
});

describe('seven cards', () => {
  it('puts a player out at seven cards: no turns, a frozen hand, and no win', async () => {
    const low = [f('A'), f('2'), f('K', 'H'), f('JK')];
    const { game, ids, card, clock } = rigged([low, handB, handC], { rest: [f('2', 'C')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' }); // a 2 on top; A holds the Start anew power
    // B flips three cards that aren't 2s: three penalty cards takes B to seven.
    game.act(ids[1], { t: 'flip', ownerId: ids[1], cardIds: [card(1, 0), card(1, 2), card(1, 3)] });
    await clock.advance(RULES.showcaseMs + 10);
    const b = game.players[1];
    expect(game.cardCount(b)).toBe(7);
    expect(b.out).toBe(true);
    expect(game.viewFor(ids[0]).players[1].out).toBe(true);
    expect(() => game.act(ids[0], { t: 'target', playerId: ids[1] })).toThrow(/out of this round/);
    game.act(ids[0], { t: 'pass' });
    expect(game.current.id).toBe(ids[2]); // B's turn is skipped
    expect(() => game.act(ids[1], { t: 'flip', ownerId: ids[1], cardIds: [card(1, 1)] })).toThrow(/out of this round/);
    game.act(ids[2], { t: 'draw' });
    game.act(ids[2], { t: 'swap', cardId: card(2, 0) });
    expect(game.current.id).toBe(ids[0]);
    game.act(ids[0], { t: 'cambio' });
    game.act(ids[2], { t: 'draw' });
    game.act(ids[2], { t: 'discard' });
    if (game.phase === 'play') game.act(ids[2], { t: 'pass' });
    expect(game.phase).toBe('reveal');
    expect(game.results!.out).toEqual([ids[1]]);
    expect(game.results!.winners).not.toContain(ids[1]);
  });

  it('the last player standing wins the round', async () => {
    const { game, ids, card, clock } = rigged([handA, handB], { rest: [f('2', 'C')] });
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'discard' });
    game.act(ids[1], { t: 'flip', ownerId: ids[1], cardIds: [card(1, 0), card(1, 2), card(1, 3)] });
    await clock.advance(RULES.showcaseMs + 10);
    expect(game.phase).toBe('reveal');
    expect(game.results).toMatchObject({ reason: 'out', winners: [ids[0]], out: [ids[1]] });
  });

  it('going out on your own turn puts your drawn card down and moves play on', async () => {
    const { game, ids, card, clock } = rigged([handA, handB, handC], { rest: [f('9', 'S'), f('4', 'C')] });
    const total = game.allCards().length;
    game.act(ids[0], { t: 'draw' });
    game.act(ids[0], { t: 'swap', cardId: card(0, 3) }); // 9♥ on top
    game.act(ids[1], { t: 'draw' }); // B holds the 4♣
    game.act(ids[1], { t: 'flip', ownerId: ids[1], cardIds: [card(1, 0), card(1, 2), card(1, 3)] });
    await clock.advance(RULES.showcaseMs + 10);
    expect(game.players[1].out).toBe(true);
    expect(game.current.id).toBe(ids[2]);
    expect(game.step.kind).toBe('start');
    expect(game.allCards()).toHaveLength(total);
  });
});
