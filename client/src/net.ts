import { useSyncExternalStore } from 'react';
import type { Action, ClientMsg, GameEvent, GameView, RoomView, ServerMsg } from '../../shared/protocol';

export interface Snapshot {
  you: string;
  room: RoomView;
  game: GameView | null;
  events: GameEvent[];
  /** Increments with every applied snapshot. */
  n: number;
}

export interface NetState {
  status: 'idle' | 'connecting' | 'open' | 'reconnecting';
  snap: Snapshot | null;
  error: { msg: string; at: number } | null;
}

const MOVING: GameEvent['type'][] = [
  'draw',
  'swap',
  'discard',
  'flip',
  'give',
  'penalty',
  'handSwap',
  'blindSwap',
  'lookSwap',
  'jokerGive',
  'jokerDeal',
  'reshuffle',
];

function storage(key: string, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export const token = (() => {
  let t = storage('cambio.token');
  if (!t) {
    t = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    store('cambio.token', t);
  }
  return t;
})();

export const savedName = () => storage('cambio.name');

class Net {
  state: NetState = { status: 'idle', snap: null, error: null };
  private listeners = new Set<() => void>();
  private ws: WebSocket | null = null;
  private target: { code: string | null; name: string } | null = null;
  private retry = 0;
  private queue: Omit<Snapshot, 'n'>[] = [];
  private pumping = false;
  private lastApplied = 0;
  private lastGap = 0;
  private n = 0;
  private pingTimer: number | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<NetState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Create a new table (code null) or join one. */
  connect(code: string | null, name: string) {
    store('cambio.name', name);
    this.target = { code, name };
    this.retry = 0;
    this.open();
  }

  private open() {
    this.ws?.close();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.set({ status: this.state.snap ? 'reconnecting' : 'connecting' });
    ws.onopen = () => {
      this.retry = 0;
      const t = this.target!;
      const msg: ClientMsg = t.code
        ? { t: 'join', code: t.code, name: t.name, token }
        : { t: 'create', name: t.name, token };
      ws.send(JSON.stringify(msg));
      this.set({ status: 'open' });
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 25_000);
    };
    ws.onmessage = (e) => this.receive(JSON.parse(e.data) as ServerMsg);
    ws.onclose = () => {
      if (this.ws !== ws || !this.target) return;
      this.set({ status: 'reconnecting' });
      const wait = Math.min(8000, 400 * 2 ** this.retry++);
      setTimeout(() => this.ws === ws && this.open(), wait);
    };
  }

  leave() {
    this.send({ t: 'leave' });
    this.target = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.queue = [];
    this.set({ status: 'idle', snap: null });
    history.replaceState(null, '', location.pathname);
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  act(a: Action) {
    this.send({ t: 'act', a });
  }

  private receive(msg: ServerMsg) {
    switch (msg.t) {
      case 'state': {
        if (this.target && !this.target.code) {
          this.target.code = msg.room.code;
          history.replaceState(null, '', `?table=${msg.room.code}`);
        }
        this.queue.push({ you: msg.you, room: msg.room, game: msg.game, events: msg.events });
        this.pump();
        break;
      }
      case 'error':
        // Routine misses (a lost race to flip) aren't worth interrupting anyone for.
        if (msg.quiet) break;
        this.set({ error: { msg: msg.msg, at: Date.now() } });
        if (msg.fatal) {
          this.target = null;
          this.ws?.close();
          this.ws = null;
          this.queue = [];
          this.set({ status: 'idle', snap: null });
          history.replaceState(null, '', location.pathname);
        }
        break;
      case 'left':
        this.target = null;
        this.ws?.close();
        this.ws = null;
        this.set({ status: 'idle', snap: null });
        history.replaceState(null, '', location.pathname);
        break;
      case 'pong':
        break;
    }
  }

  /**
   * Applies queued snapshots one at a time, leaving each movement on screen long enough to read.
   * A long backlog (a slow tab, a reconnect) drains quickly instead.
   */
  private pump() {
    if (this.pumping) return;
    this.pumping = true;
    const tick = () => {
      const next = this.queue[0];
      if (!next) {
        this.pumping = false;
        return;
      }
      const backlog = this.queue.length;
      const gap = document.hidden || backlog > 4 ? 0 : backlog > 2 ? this.lastGap / 2 : this.lastGap;
      const wait = this.lastApplied + gap - performance.now();
      if (wait > 0) {
        setTimeout(tick, wait);
        return;
      }
      this.queue.shift();
      this.lastApplied = performance.now();
      this.lastGap = gapFor(next.events);
      this.set({ snap: { ...next, n: ++this.n } });
      tick();
    };
    tick();
  }
}

function gapFor(events: GameEvent[]) {
  if (events.some((e) => e.type === 'deal')) return 900;
  if (events.some((e) => e.type === 'roundEnd')) return 600;
  if (events.some((e) => MOVING.includes(e.type))) return 320;
  return 0;
}

export const net = new Net();

export function useNet(): NetState {
  return useSyncExternalStore(net.subscribe, () => net.state);
}
