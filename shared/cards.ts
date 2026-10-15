export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'JK';

/** Jokers carry a suit only to pick their colour (H = red joker, S = black joker). */
export interface Face {
  rank: Rank;
  suit: Suit;
}

export interface Card {
  id: string;
  face: Face;
}

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const isRed = (suit: Suit) => suit === 'H' || suit === 'D';
export const isRedKing = (f: Face) => f.rank === 'K' && isRed(f.suit);

export function cardValue(f: Face): number {
  switch (f.rank) {
    case 'JK':
      return 0;
    case 'A':
      return 1;
    case 'J':
      return 11;
    case 'Q':
      return 12;
    case 'K':
      return isRed(f.suit) ? -1 : 13;
    default:
      return Number(f.rank);
  }
}

export type PowerKind =
  | 'joker'
  | 'handSwap'
  | 'drawAgain'
  | 'skip'
  | 'peekOwn'
  | 'peekOther'
  | 'blindSwap'
  | 'lookSwap';

export function powerOf(f: Face): PowerKind | null {
  switch (f.rank) {
    case 'JK':
      return 'joker';
    case 'A':
    case '2':
      return 'handSwap';
    case '3':
    case '4':
      return 'drawAgain';
    case '5':
    case '6':
      return 'skip';
    case '7':
    case '8':
      return 'peekOwn';
    case '9':
    case '10':
      return 'peekOther';
    case 'J':
    case 'Q':
      return 'blindSwap';
    case 'K':
      return isRed(f.suit) ? null : 'lookSwap';
  }
}

export interface PowerInfo {
  ranks: string;
  rhyme: string;
  title: string;
  /** What the player is asked to do while choosing. */
  prompt: string;
  /** One-line rules text. */
  rule: string;
}

export const POWERS: Record<PowerKind, PowerInfo> = {
  joker: {
    ranks: 'Joker',
    rhyme: 'Joker Poker',
    title: 'Joker Poker',
    prompt: 'Everyone hands you a card. Deal them back however you like.',
    rule: 'Every other player gives you a card. You see them all, then deal them back out however you like.',
  },
  handSwap: {
    ranks: 'A & 2',
    rhyme: 'start anew',
    title: 'Start anew',
    prompt: 'Pick a player to trade whole hands with, sight unseen.',
    rule: 'Trade your entire hand with another player, blind. Played on the Cambio caller, it cancels their call instead.',
  },
  drawAgain: {
    ranks: '3 & 4',
    rhyme: 'try one more',
    title: 'Try one more',
    prompt: 'Draw another card from the deck.',
    rule: 'Draw another card from the deck and play it.',
  },
  skip: {
    ranks: '5 & 6',
    rhyme: 'play some tricks',
    title: 'Play some tricks',
    prompt: 'Choose a player to skip on their next turn.',
    rule: 'Skip another player’s next turn. A skipped player is immune for a round. Skipping the Cambio caller buys everyone another lap.',
  },
  peekOwn: {
    ranks: '7 & 8',
    rhyme: 'know your fate',
    title: 'Know your fate',
    prompt: 'Tap one of your cards to peek at it.',
    rule: 'Peek at one of your own cards.',
  },
  peekOther: {
    ranks: '9 & 10',
    rhyme: 'phone a friend',
    title: 'Phone a friend',
    prompt: 'Tap someone else’s card to peek at it.',
    rule: 'Peek at one card in someone else’s hand.',
  },
  blindSwap: {
    ranks: 'J & Q',
    rhyme: 'swap between',
    title: 'Swap between',
    prompt: 'Tap any two cards to swap them, unseen.',
    rule: 'Swap any two cards on the table without looking.',
  },
  lookSwap: {
    ranks: 'Black K',
    rhyme: 'look and swap',
    title: 'Look and swap',
    prompt: 'Tap any two cards to look at them.',
    rule: 'Look at any two cards, then swap them if you like.',
  },
};

export const POWER_ORDER: PowerKind[] = [
  'joker',
  'handSwap',
  'drawAgain',
  'skip',
  'peekOwn',
  'peekOther',
  'blindSwap',
  'lookSwap',
];

export function rankLabel(r: Rank) {
  return r === 'JK' ? 'Joker' : r;
}

export function rankName(r: Rank, plural = false): string {
  const names: Record<Rank, string> = {
    A: 'Ace',
    '2': 'Two',
    '3': 'Three',
    '4': 'Four',
    '5': 'Five',
    '6': 'Six',
    '7': 'Seven',
    '8': 'Eight',
    '9': 'Nine',
    '10': 'Ten',
    J: 'Jack',
    Q: 'Queen',
    K: 'King',
    JK: 'Joker',
  };
  const n = names[r];
  if (!plural) return n;
  return r === '6' ? 'Sixes' : n + 's';
}

let idCounter = 0;
export function newCardId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return Math.random().toString(36).slice(2, 8) + idCounter.toString(36);
}

export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ id: newCardId(), face: { rank, suit } });
  deck.push({ id: newCardId(), face: { rank: 'JK', suit: 'H' } });
  deck.push({ id: newCardId(), face: { rank: 'JK', suit: 'S' } });
  return shuffle(deck);
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
