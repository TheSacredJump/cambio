import type { Face, PowerKind, Rank } from './cards';

/** A card as one viewer sees it. `face` is present only when this viewer may see it right now. */
export interface CardView {
  id: string;
  face?: Face;
}

export type PowerStage = 'choose' | 'viewing' | 'decide' | 'offer' | 'collect' | 'assign';

export interface JokerView {
  /** Players who still have to hand over a card. */
  waiting: string[];
  /** The cards handed over so far, by giver. Faces visible to the Joker player while dealing. */
  pool: { from: string; card: CardView }[];
  /** recipient id -> card id, while the Joker player is dealing. */
  assignment: Record<string, string> | null;
}

export type StepView =
  | { kind: 'idle' }
  | { kind: 'start' }
  | { kind: 'drawn'; card: CardView; from: 'deck' | 'discard' }
  | { kind: 'skipped'; playerId: string; extended: boolean }
  | {
      kind: 'power';
      power: PowerKind;
      stage: PowerStage;
      /** Cards involved in the current stage (peeked, or chosen for a look-and-swap). */
      cardIds: string[];
      joker: JokerView | null;
    };

export interface PlayerView {
  id: string;
  slots: (CardView | null)[];
  skipPending: boolean;
  immune: boolean;
  ready: boolean;
  /** After flipping someone else's card, this player may hand them this many of theirs, briefly. */
  owes: { to: string; count: number } | null;
  /** Out of the round for holding seven cards. */
  out: boolean;
}

export interface RoundResults {
  scores: Record<string, number>;
  points: Record<string, number>;
  caller: string | null;
  winners: string[];
  /** Players knocked out for holding seven cards. */
  out: string[];
  reason: 'cambio' | 'deck' | 'out';
}

export interface GameView {
  phase: 'peek' | 'play' | 'reveal';
  round: number;
  turn: { playerId: string; step: StepView; seq: number };
  players: PlayerView[];
  deckCount: number;
  /** The top few discards, bottom to top. */
  discard: CardView[];
  discardCount: number;
  /** The discard you may flip onto. Once someone flips correctly, only they may continue, from that hand. */
  flip: { open: boolean; rank: Rank | null; claim: { by: string; owner: string } | null };
  /** True only for the viewer, on their turn, when their hand is low enough to call Cambio. */
  canCambio: boolean;
  caller: string | null;
  /** Cards someone is privately looking at right now (everyone sees that they are looking). */
  peeks: { by: string; cardIds: string[] }[];
  /** Cards shown face-up to everyone (a wrong flip). */
  showcase: string[];
  /** What the active player is pointing at while choosing targets. */
  selecting: { by: string; cardIds: string[] } | null;
  initialPeekSlots: number[];
  results: RoundResults | null;
  cambioLimit: number;
  outAt: number;
  /** How long you have to hand a card over after flipping someone else's. */
  giftMs: number;
}

export type GameEvent =
  | { type: 'deal' }
  | { type: 'begin'; playerId: string }
  | { type: 'turn'; playerId: string }
  | { type: 'draw'; playerId: string; from: 'deck' | 'discard' }
  | { type: 'swap'; playerId: string; face: Face }
  | { type: 'discard'; playerId: string; face: Face }
  | { type: 'power'; playerId: string; power: PowerKind }
  | { type: 'pass'; playerId: string; power: PowerKind }
  | { type: 'peek'; playerId: string; ownerId: string }
  | { type: 'blindSwap'; playerId: string; owners: [string, string] }
  | { type: 'lookSwap'; playerId: string; owners: [string, string]; swapped: boolean }
  | { type: 'skip'; playerId: string; target: string }
  | { type: 'skipped'; playerId: string; extended: boolean }
  | { type: 'handSwap'; playerId: string; target: string }
  | { type: 'drawAgain'; playerId: string }
  | { type: 'jokerGive'; playerId: string; to: string }
  | { type: 'jokerDeal'; playerId: string }
  | {
      type: 'flip';
      playerId: string;
      ownerId: string;
      rank: Rank;
      correct: string[];
      wrong: string[];
    }
  | { type: 'give'; playerId: string; to: string; count: number }
  | { type: 'penalty'; playerId: string; count: number }
  | { type: 'out'; playerId: string }
  | { type: 'cambio'; playerId: string }
  | { type: 'cambioCancelled'; playerId: string; target: string }
  | { type: 'reshuffle' }
  | { type: 'roundEnd'; results: RoundResults };

export type Action =
  | { t: 'ready' }
  | { t: 'draw' }
  | { t: 'take' }
  | { t: 'cambio' }
  | { t: 'swap'; cardId: string }
  | { t: 'discard' }
  | { t: 'peek'; cardId: string }
  | { t: 'pickTwo'; a: string; b: string }
  | { t: 'decide'; swap: boolean }
  | { t: 'target'; playerId: string }
  | { t: 'again' }
  | { t: 'pass' }
  | { t: 'jokerPick'; cardId: string }
  | { t: 'jokerArrange'; assignment: Record<string, string> }
  | { t: 'jokerDeal' }
  | { t: 'flip'; ownerId: string; cardIds: string[] }
  | { t: 'give'; cardIds: string[] }
  | { t: 'select'; cardIds: string[] };

export interface MemberView {
  id: string;
  name: string;
  isBot: boolean;
  connected: boolean;
  /** Hue (0-360) used for this player's accent. */
  hue: number;
}

export interface RoomView {
  code: string;
  hostId: string;
  members: MemberView[];
  /** Cumulative points across finished rounds. */
  totals: Record<string, number>;
  roundsPlayed: number;
  /** Round-by-round points, oldest first. */
  history: Record<string, number>[];
  /** Someone has reached the target; the next round starts a fresh match. */
  matchOver: boolean;
  target: number;
}

export type ClientMsg =
  | { t: 'create'; name: string; token: string }
  | { t: 'join'; code: string; name: string; token: string }
  | { t: 'act'; a: Action }
  | { t: 'start' }
  | { t: 'addBot' }
  | { t: 'kick'; id: string }
  | { t: 'nextRound' }
  | { t: 'leave' }
  | { t: 'ping' };

export type ServerMsg =
  | {
      t: 'state';
      you: string;
      room: RoomView;
      game: GameView | null;
      events: GameEvent[];
    }
  | { t: 'error'; msg: string; fatal?: boolean; quiet?: boolean }
  | { t: 'left' }
  | { t: 'pong' };
