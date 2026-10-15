import { BotBrain, type BotDecision } from './bot';
import { Game, GameError, type Scheduler } from './game';
import type { ClientMsg, GameEvent, RoomView, ServerMsg } from './protocol';

export const MAX_PLAYERS = 8;
export const MATCH_TARGET = 100;
/** A disconnected player is played by a bot after this long. */
const AUTOPILOT_AFTER_MS = 12_000;

const BOT_NAMES = ['Ada', 'Basil', 'Coco', 'Dante', 'Esme', 'Felix', 'Gigi', 'Hugo', 'Iris', 'Juno', 'Kit', 'Lola', 'Milo', 'Nell', 'Otto', 'Pia'];
const HUES = [38, 205, 0, 130, 280, 22, 175, 52];

export interface Member {
  id: string;
  name: string;
  token: string;
  isBot: boolean;
  connected: boolean;
  hue: number;
  /** Plays for a bot, or for a human who has dropped out mid-game. */
  brain: BotBrain | null;
  autopilot: boolean;
  dropTimer: (() => void) | null;
}

type Sink = (msg: ServerMsg) => void;

interface BotTimer {
  key: string;
  cancel: () => void;
}

let memberCounter = 0;
const newMemberId = () => 'p' + (++memberCounter).toString(36) + Math.random().toString(36).slice(2, 6);

export class Room {
  members: Member[] = [];
  hostId = '';
  game: Game | null = null;
  totals: Record<string, number> = {};
  history: Record<string, number>[] = [];
  roundsPlayed = 0;
  /** Seat order for the current game (member ids). */
  seats: string[] = [];
  lastActivity = Date.now();

  private sinks = new Map<string, Sink>();
  private outbox = new Map<string, GameEvent[]>();
  private flushQueued = false;
  private botTimers = new Map<string, { main?: BotTimer; flip?: BotTimer }>();
  private firstPlayer = 0;
  private matchOver = false;

  constructor(
    readonly code: string,
    private readonly schedule: Scheduler,
  ) {}

  // ───────────────────────────── membership

  /** Adds a human, or reclaims their seat when the token matches someone already here. */
  join(name: string, token: string): Member {
    const existing = this.members.find((m) => !m.isBot && m.token === token);
    if (existing) {
      if (name.trim()) existing.name = cleanName(name);
      return existing;
    }
    if (this.members.length >= MAX_PLAYERS && !this.game) throw new GameError('This table is full.');
    const m: Member = {
      id: newMemberId(),
      name: cleanName(name) || 'Player',
      token,
      isBot: false,
      connected: false,
      hue: this.nextHue(),
      brain: null,
      autopilot: false,
      dropTimer: null,
    };
    this.members.push(m);
    if (!this.hostId || !this.members.some((x) => x.id === this.hostId && !x.isBot)) this.hostId = m.id;
    this.changed();
    return m;
  }

  connect(memberId: string, sink: Sink) {
    const m = this.member(memberId);
    this.sinks.set(memberId, sink);
    m.connected = true;
    m.dropTimer?.();
    m.dropTimer = null;
    if (m.autopilot) {
      m.autopilot = false;
      m.brain = null;
      this.clearBotTimers(m.id);
    }
    this.lastActivity = Date.now();
    this.changed();
  }

  disconnect(memberId: string, sink: Sink) {
    if (this.sinks.get(memberId) !== sink) return;
    this.sinks.delete(memberId);
    const m = this.members.find((x) => x.id === memberId);
    if (!m) return;
    m.connected = false;
    if (this.inGame(m.id)) {
      m.dropTimer = this.schedule(AUTOPILOT_AFTER_MS, () => {
        m.dropTimer = null;
        if (m.connected || !this.inGame(m.id)) return;
        m.autopilot = true;
        m.brain = new BotBrain(m.id, 0.5);
        this.changed();
      });
    } else if (!this.game) {
      this.removeMember(m.id);
    }
    this.changed();
  }

  get connectedHumans() {
    return this.members.filter((m) => !m.isBot && m.connected).length;
  }

  private member(id: string) {
    const m = this.members.find((x) => x.id === id);
    if (!m) throw new GameError('You aren’t at this table.');
    return m;
  }

  private nextHue() {
    const used = new Set(this.members.map((m) => m.hue));
    return HUES.find((h) => !used.has(h)) ?? Math.floor(Math.random() * 360);
  }

  private inGame(id: string) {
    return !!this.game && this.seats.includes(id);
  }

  private removeMember(id: string) {
    this.members = this.members.filter((m) => m.id !== id);
    this.clearBotTimers(id);
    delete this.totals[id];
    if (this.hostId === id) this.hostId = this.members.find((m) => !m.isBot)?.id ?? '';
  }

  // ───────────────────────────── messages

  handle(memberId: string, msg: ClientMsg) {
    const m = this.member(memberId);
    this.lastActivity = Date.now();
    switch (msg.t) {
      case 'act':
        if (!this.game || !this.inGame(m.id)) throw new GameError('You aren’t playing this round.');
        this.game.act(m.id, msg.a);
        break;
      case 'addBot': {
        this.requireHost(m);
        if (this.game && this.game.phase !== 'reveal') throw new GameError('Add players between rounds.');
        if (this.members.length >= MAX_PLAYERS) throw new GameError(`A table seats ${MAX_PLAYERS}.`);
        const used = new Set(this.members.map((x) => x.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) ?? 'Bot';
        const id = newMemberId();
        this.members.push({
          id,
          name,
          token: '',
          isBot: true,
          connected: true,
          hue: this.nextHue(),
          brain: new BotBrain(id, 0.65 + Math.random() * 0.3),
          autopilot: false,
          dropTimer: null,
        });
        break;
      }
      case 'kick': {
        this.requireHost(m);
        if (this.game && this.game.phase !== 'reveal') throw new GameError('Remove players between rounds.');
        if (msg.id === m.id) throw new GameError('You can’t remove yourself.');
        const target = this.member(msg.id);
        this.sinks.get(target.id)?.({ t: 'left' });
        this.sinks.delete(target.id);
        this.removeMember(target.id);
        break;
      }
      case 'start':
      case 'nextRound':
        this.requireHost(m);
        this.startRound();
        break;
      case 'leave':
        this.sinks.get(m.id)?.({ t: 'left' });
        this.sinks.delete(m.id);
        if (this.inGame(m.id) && this.game?.phase !== 'reveal') {
          m.connected = false;
          m.autopilot = true;
          m.brain = new BotBrain(m.id, 0.5);
        } else {
          this.removeMember(m.id);
        }
        break;
      default:
        break;
    }
    this.changed();
  }

  private requireHost(m: Member) {
    if (m.id !== this.hostId) throw new GameError('Only the host can do that.');
  }

  private startRound() {
    if (this.game && this.game.phase !== 'reveal') throw new GameError('A round is already in play.');
    const players = this.members.filter((m) => m.isBot || m.connected);
    if (players.length < 2) throw new GameError('You need at least two players. Invite a friend or add a bot.');
    if (this.matchOver) {
      this.totals = {};
      this.history = [];
      this.roundsPlayed = 0;
      this.matchOver = false;
    }
    this.game?.dispose();
    for (const id of this.botTimers.keys()) this.clearBotTimers(id);
    for (const m of this.members) m.brain?.forget();
    this.seats = players.map((m) => m.id);
    for (const id of this.seats) this.totals[id] ??= 0;
    this.game = new Game(this.seats, {
      firstPlayer: this.firstPlayer++ % this.seats.length,
      round: this.roundsPlayed + 1,
      schedule: this.schedule,
      onChange: () => this.changed(),
    });
  }

  // ───────────────────────────── broadcast

  changed() {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.flush();
    });
  }

  private flush() {
    const events = this.game?.drainEvents() ?? [];
    for (const e of events) if (e.type === 'roundEnd') this.recordRound(e.results.points, e.results.winners);
    const room = this.roomView();
    for (const m of this.members) {
      if (m.isBot) continue;
      const box = this.outbox.get(m.id) ?? [];
      box.push(...events);
      const sink = this.sinks.get(m.id);
      if (!sink) {
        this.outbox.set(m.id, box.slice(-30));
        continue;
      }
      this.outbox.delete(m.id);
      sink({ t: 'state', you: m.id, room, game: this.game?.viewFor(m.id) ?? null, events: box });
    }
    this.driveBots();
  }

  private recordRound(points: Record<string, number>, winners: string[]) {
    const row: Record<string, number> = {};
    for (const id of this.seats) {
      // Round winners score nothing; everyone else adds their hand.
      row[id] = winners.includes(id) ? 0 : points[id];
      this.totals[id] = (this.totals[id] ?? 0) + row[id];
    }
    this.history.push(row);
    this.roundsPlayed++;
    if (Object.values(this.totals).some((t) => t >= MATCH_TARGET)) this.matchOver = true;
  }

  roomView(): RoomView {
    return {
      code: this.code,
      hostId: this.hostId,
      members: this.members.map((m) => ({
        id: m.id,
        name: m.name,
        isBot: m.isBot,
        connected: m.isBot || m.connected,
        hue: m.hue,
      })),
      totals: { ...this.totals },
      roundsPlayed: this.roundsPlayed,
      history: this.history.map((r) => ({ ...r })),
      matchOver: this.matchOver,
      target: MATCH_TARGET,
    };
  }

  // ───────────────────────────── bots

  private driveBots() {
    const game = this.game;
    if (!game) return;
    for (const m of this.members) {
      if (!m.brain || !this.inGame(m.id)) continue;
      const view = game.viewFor(m.id);
      m.brain.observe(view);
      this.arm(m, 'main', m.brain.decide(view));
      // Humans on autopilot don't race anyone to flips.
      if (m.isBot) this.arm(m, 'flip', m.brain.decideFlip(view));
    }
  }

  private arm(m: Member, slot: 'main' | 'flip', d: BotDecision | null) {
    const timers = this.botTimers.get(m.id) ?? {};
    this.botTimers.set(m.id, timers);
    const current = timers[slot];
    if (current && d && current.key === d.key) return;
    current?.cancel();
    timers[slot] = undefined;
    if (!d) return;
    const timer: BotTimer = {
      key: d.key,
      cancel: this.schedule(d.delay, () => {
        if (timers[slot] !== timer) return;
        timers[slot] = undefined;
        this.fireBot(m, slot, d);
      }),
    };
    timers[slot] = timer;
  }

  private fireBot(m: Member, slot: 'main' | 'flip', planned: BotDecision) {
    const game = this.game;
    if (!game || !m.brain) return;
    // Re-decide against the latest state so a stale plan is never played.
    const view = game.viewFor(m.id);
    m.brain.observe(view);
    const fresh = slot === 'main' ? m.brain.decide(view) : m.brain.decideFlip(view);
    if (!fresh || fresh.key !== planned.key) return this.changed();
    try {
      game.act(m.id, fresh.action);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      // The plan no longer fits; fall back to something that always works for this step.
      this.fallback(m.id);
    }
    this.changed();
  }

  private fallback(id: string) {
    const game = this.game!;
    const view = game.viewFor(id);
    const step = view.turn.step;
    const tries: Parameters<Game['act']>[1][] = [];
    if (view.turn.playerId === id) {
      if (step.kind === 'start') tries.push({ t: 'draw' });
      if (step.kind === 'drawn') {
        tries.push({ t: 'discard' });
        const mine = view.players.find((p) => p.id === id)!.slots.find((c) => c);
        if (mine) tries.push({ t: 'swap', cardId: mine.id });
      }
      if (step.kind === 'power') tries.push({ t: 'pass' });
    }
    for (const a of tries) {
      try {
        game.act(id, a);
        return;
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
      }
    }
  }

  private clearBotTimers(id: string) {
    const t = this.botTimers.get(id);
    t?.main?.cancel();
    t?.flip?.cancel();
    this.botTimers.delete(id);
  }

  dispose() {
    this.game?.dispose();
    for (const id of this.botTimers.keys()) this.clearBotTimers(id);
    for (const m of this.members) m.dropTimer?.();
  }
}

function cleanName(name: string) {
  return name.replace(/\s+/g, ' ').trim().slice(0, 18);
}
