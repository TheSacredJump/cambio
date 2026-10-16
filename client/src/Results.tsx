import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { useEffect } from 'react';
import type { GameView, RoomView } from '../../shared/protocol';
import { net } from './net';
import { MiniCard } from './Rules';

function CountUp({ to, delay }: { to: number; delay: number }) {
  const v = useMotionValue(0);
  const text = useTransform(v, (x) => Math.round(x).toString());
  useEffect(() => {
    const c = animate(v, to, { duration: 0.9, delay, ease: [0.23, 1, 0.32, 1] });
    return () => c.stop();
  }, [to, delay, v]);
  return <motion.span>{text}</motion.span>;
}

export function Results({ room, game, you, name }: { room: RoomView; game: GameView; you: string; name: (id: string) => string }) {
  const r = game.results!;
  const host = room.hostId === you;
  // Players still standing first, then anyone who went out. Within a tie on points, the winner leads.
  const won = (id: string) => Number(r.winners.includes(id));
  const rows = [...game.players].sort((a, b) => Number(a.out) - Number(b.out) || r.points[a.id] - r.points[b.id] || won(b.id) - won(a.id));
  const lastRow = room.history[room.history.length - 1] ?? {};
  const champion = room.matchOver
    ? Object.entries(room.totals).sort((a, b) => a[1] - b[1])[0]?.[0]
    : null;
  const headline = r.winners.length > 1 ? `${r.winners.map(name).join(' & ')} tie` : `${name(r.winners[0])} ${r.winners[0] === you ? 'win' : 'wins'} the round`;

  return (
    <motion.div className="scrim results-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="sheet results"
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      >
        <span className="eyebrow">Round {game.round}</span>
        <h2 className="sheet-title">{headline}</h2>
        {r.reason === 'deck' && <p className="results-note">The deck ran out</p>}
        {r.reason === 'out' && <p className="results-note">Last one standing</p>}
        {r.tiebreak === 'cards' && <p className="results-note">Tied on points, so fewer cards wins</p>}
        {r.tiebreak === 'caller' && <p className="results-note">A tie goes against the Cambio caller</p>}

        <div className="results-legend" aria-hidden="true">
          <span />
          <span />
          <span>Hand</span>
          <span>Adds</span>
          <span>Total</span>
        </div>
        <ol className="results-rows">
          {rows.map((p, i) => {
            const win = r.winners.includes(p.id);
            return (
              <motion.li
                key={p.id}
                className={`results-row${win ? ' is-win' : ''}${p.id === you ? ' is-me' : ''}`}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.15 + i * 0.08, type: 'spring', stiffness: 400, damping: 32 }}
              >
                <span className="results-name">
                  {name(p.id)}
                  {r.caller === p.id && <span className="chip chip-cambio">Cambio</span>}
                  {r.out.includes(p.id) && <span className="chip chip-out">Out</span>}
                </span>
                <span className="results-hand">
                  {p.slots.map((c, j) => (c?.face ? <MiniCard key={c.id} face={c.face} w={30} /> : c ? null : <span key={'e' + j} className="mini-gap" />))}
                  {!p.slots.some(Boolean) && <span className="results-empty">no cards</span>}
                </span>
                <span className="results-score">
                  <CountUp to={r.scores[p.id]} delay={0.3 + i * 0.08} />
                </span>
                <span className="results-add">{win ? '+0' : `+${lastRow[p.id] ?? r.points[p.id]}`}</span>
                <span className="results-total">{room.totals[p.id] ?? 0}</span>
              </motion.li>
            );
          })}
        </ol>

        {champion && (
          <motion.p className="results-champion" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.8 }}>
            {name(champion)} {champion === you ? 'win' : 'wins'} the match
          </motion.p>
        )}

        <div className="results-actions">
          {host ? (
            <button className="btn btn-primary" onClick={() => net.send({ t: 'nextRound' })}>
              {room.matchOver ? 'New match' : 'Deal the next round'}
            </button>
          ) : (
            <span className="results-wait">Waiting for {name(room.hostId)} to deal the next round…</span>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
