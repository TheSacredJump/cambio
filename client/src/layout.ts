import type { GameView } from '../../shared/protocol';

export interface Viewport {
  w: number;
  h: number;
  top: number;
  bottom: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Seat {
  id: string;
  me: boolean;
  /** Grid centre. */
  x: number;
  y: number;
  /** Card scale relative to the base card. */
  s: number;
  cols: number;
  gridW: number;
  gridH: number;
  plate: Pt;
  /** Widest the nameplate may be, when space is tight. */
  plateMax?: number;
  /** Which side of the grid a drawn card is held on. */
  hold: 1 | -1;
}

export interface Layout {
  base: number;
  ch: number;
  mobile: boolean;
  seats: Map<string, Seat>;
  order: string[];
  center: Pt;
  deck: Pt;
  discard: Pt;
  pileS: number;
  captionY: number;
  promptY: number;
  /** Where the active seat's lamp light points. */
  lamp: (id: string) => Pt;
  slot: (seat: Seat, i: number) => Pt;
  drawn: (seat: Seat) => Pt & { s: number; rot: number };
  pool: (i: number, n: number) => Pt & { s: number };
}

const RATIO = 1.4;
const GAP = 0.12;

function grid(slots: number, base: number, s: number) {
  const cols = Math.max(2, Math.ceil(slots / 2));
  const cw = base * s;
  const gridW = cols * cw + (cols - 1) * cw * GAP;
  const gridH = 2 * cw * RATIO + cw * GAP;
  return { cols, gridW, gridH };
}

export function computeLayout(vp: Viewport, game: GameView, you: string): Layout {
  const { w, h } = vp;
  const players = game.players;
  const meIdx = Math.max(0, players.findIndex((p) => p.id === you));
  const order = players.map((_, i) => players[(meIdx + i) % players.length].id);
  const others = order.slice(1);
  const m = others.length;
  const slotsOf = (id: string) => players.find((p) => p.id === id)!.slots.length;
  const mobile = w < 640 && h > w * 1.1;
  const H = h - vp.top - vp.bottom;
  const seats = new Map<string, Seat>();
  const meIsPlayer = players.some((p) => p.id === you);

  let base: number;
  let oppS = 0.6;
  let topBandBottom: number;
  const pileS = mobile ? 0.82 : 0.88;

  if (mobile) {
    // A strip at the top holds the table code and buttons; opponents sit in one or two rows below it.
    const strip = 48;
    const rows = m <= 3 ? 1 : 2;
    const perRow = Math.ceil(m / rows);
    const cellW = (w - 16) / perRow;
    const widest = Math.max(2, ...others.map((id) => Math.ceil(slotsOf(id) / 2)));
    const fitS = (b: number) => Math.min(m === 1 ? 0.6 : 0.54, (cellW - 14) / (b * (widest + (widest - 1) * GAP)));
    const fixed = strip + rows * 22 + 24 + 22 + 74 + 30 + 14;
    base = Math.min(w * 0.2, 96);
    for (let i = 0; i < 3; i++) {
      oppS = fitS(base);
      base = Math.min(w * 0.2, 96, (H - fixed) / (2.98 + 1.4 * pileS + rows * oppS * 2.98));
    }
    base = Math.max(base, 44);
    oppS = fitS(base);
    const rowH = 2 * base * oppS * RATIO + base * oppS * GAP + 22;
    others.forEach((id, k) => {
      const row = Math.floor(k / perRow);
      const inRow = row === rows - 1 ? m - perRow * (rows - 1) : perRow;
      const col = k - row * perRow;
      const rowCellW = (w - 16) / inRow;
      const g = grid(slotsOf(id), base, oppS);
      const x = 8 + rowCellW * (col + 0.5);
      const y = vp.top + strip + row * rowH + g.gridH / 2;
      seats.set(id, {
        id,
        me: false,
        x,
        y,
        s: oppS,
        ...g,
        plate: { x, y: y + g.gridH / 2 + 11 },
        plateMax: rowCellW - 6,
        hold: x > w / 2 ? -1 : 1,
      });
    });
    topBandBottom = vp.top + strip + rows * rowH;
  } else {
    oppS = m <= 3 ? 0.6 : m <= 5 ? 0.55 : 0.5;
    base = Math.min(w * 0.082, (H - 196) / (2.92 + 1.232 + oppS * 2.92), 112);
    base = Math.max(base, 46);
    const tallest = Math.max(0, ...others.map((id) => grid(slotsOf(id), base, oppS).gridH));
    topBandBottom = vp.top + 12 + tallest + 26;
  }

  const ch = base * RATIO;

  // Me, at the bottom.
  const meId = order[0];
  const mg = grid(slotsOf(meId), base, 1);
  const holdRoom = base * 1.25;
  let meX = w / 2;
  if (meX + mg.gridW / 2 + holdRoom > w - 12) meX = Math.max(mg.gridW / 2 + 10, w - 12 - holdRoom - mg.gridW / 2);
  const meY = h - vp.bottom - 30 - mg.gridH / 2;
  seats.set(meId, {
    id: meId,
    me: meIsPlayer,
    x: meX,
    y: meY,
    s: 1,
    ...mg,
    plate: { x: meX, y: meY + mg.gridH / 2 + 15 },
    hold: 1,
  });

  const myTop = meY - mg.gridH / 2;
  const pileHalf = (ch * pileS) / 2;
  // Below the piles: their labels, then the prompt, then your hand.
  const below = mobile ? 70 : 86;
  const lowest = topBandBottom + 26 + pileHalf;
  const highest = myTop - below - pileHalf;
  const cy = Math.max(lowest, Math.min(highest, (topBandBottom + myTop) / 2 - 18));
  const cx = w / 2;
  const center = { x: cx, y: cy };

  if (!mobile && m) {
    let angles: number[];
    if (m === 1) angles = [270];
    else if (m === 2) angles = [212, 328];
    else if (m === 3) angles = [184, 270, 356];
    else {
      // Bigger tables wrap further round, down into the free corners either side of your hand.
      const spread = m >= 6 ? 244 : 210;
      angles = others.map((_, k) => 270 - spread / 2 + (k * spread) / (m - 1));
    }
    const myLeft = meX - mg.gridW / 2 - 16;
    const myRight = meX + mg.gridW / 2 + holdRoom + 16;
    const place = (scale: number) => {
      const placed: Seat[] = [];
      const tallest = Math.max(...others.map((id) => grid(slotsOf(id), base, scale).gridH));
      const topY = vp.top + 12 + tallest / 2;
      const ryUp = Math.max(40, cy - topY);
      others.forEach((id, k) => {
        const g = grid(slotsOf(id), base, scale);
        const rx = Math.min(w * 0.42, w / 2 - g.gridW / 2 - 16);
        const th = (angles[k] * Math.PI) / 180;
        const sin = Math.sin(th);
        const ryDown = Math.max(40, h - vp.bottom - 34 - g.gridH / 2 - cy);
        let x = cx + rx * Math.cos(th);
        let y = cy + (sin < 0 ? ryUp : ryDown) * sin;
        x = Math.min(w - g.gridW / 2 - 14, Math.max(g.gridW / 2 + 14, x));
        // Only seats that would sit over your hand need to stay above it.
        const besideMe = x + g.gridW / 2 < myLeft || x - g.gridW / 2 > myRight;
        const floor = besideMe ? h - vp.bottom - 30 - g.gridH / 2 : myTop - g.gridH / 2 - 40;
        y = Math.max(vp.top + 12 + g.gridH / 2, Math.min(floor, y));
        placed.push({ id, me: false, x, y, s: scale, ...g, plate: { x, y: y + g.gridH / 2 + 13 }, hold: x > cx + 10 ? -1 : 1 });
      });
      return placed;
    };
    const overlaps = (a: Seat, b: Seat) =>
      Math.abs(a.x - b.x) < (a.gridW + b.gridW) / 2 + 12 && Math.abs(a.y - b.y) < (a.gridH + b.gridH) / 2 + 30;
    let placed = place(oppS);
    for (let i = 0; i < 6 && placed.some((a, j) => placed.some((b, k) => k > j && overlaps(a, b))); i++) {
      oppS *= 0.92;
      placed = place(oppS);
    }
    for (const seat of placed) seats.set(seat.id, seat);
  }

  const pileGap = base * pileS * 0.68;
  const deck = { x: cx - pileGap, y: cy };
  const discard = { x: cx + pileGap, y: cy };
  const captionY = cy - pileHalf - 20;
  const promptY = Math.max(cy + pileHalf + (mobile ? 40 : 54), Math.min(myTop - 38, cy + pileHalf + (myTop - cy - pileHalf) / 2 + 6));

  const slot = (seat: Seat, i: number): Pt => {
    const cw = base * seat.s;
    const col = Math.floor(i / 2);
    const row = i % 2;
    return {
      x: seat.x + (col - (seat.cols - 1) / 2) * cw * (1 + GAP),
      y: seat.y + (row - 0.5) * (cw * RATIO + cw * GAP),
    };
  };

  const drawn = (seat: Seat) => {
    if (seat.me) {
      return { x: seat.x + seat.gridW / 2 + base * 0.72, y: seat.y - ch * 0.08, s: 1.04, rot: 4 };
    }
    const s = seat.s * 1.05;
    return {
      x: seat.x + seat.hold * (seat.gridW / 2 + base * s * 0.62),
      y: seat.y - base * s * 0.1,
      s,
      rot: seat.hold * 7,
    };
  };

  const pool = (i: number, n: number) => {
    const s = Math.min(mobile ? 0.7 : 0.8, (w - 32) / (n * base * 1.12));
    const step = base * s * 1.12;
    return { x: cx + (i - (n - 1) / 2) * step, y: cy - ch * 0.04, s };
  };

  const lamp = (id: string): Pt => {
    const seat = seats.get(id);
    if (!seat) return center;
    return { x: cx + (seat.x - cx) * 0.55, y: cy + (seat.y - cy) * 0.55 };
  };

  return { base, ch, mobile, seats, order, center, deck, discard, pileS, captionY, promptY, lamp, slot, drawn, pool };
}
