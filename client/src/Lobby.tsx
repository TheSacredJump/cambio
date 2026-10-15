import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Face } from '../../shared/cards';
import type { RoomView } from '../../shared/protocol';
import { CardFace } from './art';
import { net, savedName, type NetState } from './net';
import { RulesButton } from './Hud';
import { sound } from './sound';

const FAN: Face[] = [
  { rank: '7', suit: 'S' },
  { rank: 'K', suit: 'H' },
  { rank: 'JK', suit: 'S' },
  { rank: 'Q', suit: 'D' },
];

/** Four cards fanned in a hand. One at a time turns over and back. */
function Fan() {
  const [up, setUp] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setUp((u) => (u + 1) % FAN.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="fan" aria-hidden="true">
      {FAN.map((f, i) => {
        const off = i - (FAN.length - 1) / 2;
        return (
          <motion.div
            key={i}
            className="fan-card"
            initial={{ opacity: 0, y: 60, rotate: 0 }}
            animate={{ opacity: 1, y: Math.abs(off) * 10, rotate: off * 9, x: off * 44 }}
            transition={{ type: 'spring', stiffness: 160, damping: 20, delay: 0.15 + i * 0.08 }}
          >
            <motion.div
              className="flipper"
              initial={{ rotateY: 180 }}
              animate={{ rotateY: up === i ? 0 : 180 }}
              transition={{ type: 'spring', stiffness: 170, damping: 20 }}
              style={{ transformPerspective: 900 }}
            >
              <div className="face front">
                <CardFace face={f} />
              </div>
              <div className="face back" />
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
}

function initialCode() {
  const q = new URLSearchParams(location.search).get('table');
  return q ? q.toUpperCase().slice(0, 4) : '';
}

export function Home({ state }: { state: NetState }) {
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(initialCode);
  const busy = state.status === 'connecting';
  const invited = initialCode().length === 4;

  // Coming back to an open table (a refresh, a dropped connection): rejoin straight away.
  useEffect(() => {
    if (invited && savedName() && state.status === 'idle' && !state.error) net.connect(initialCode(), savedName());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (c: string | null) => {
    sound.unlock();
    if (!name.trim()) return;
    net.connect(c, name.trim());
  };

  return (
    <div className="home" onPointerDown={() => sound.unlock()}>
      <div className="felt" />
      <div className="grain" />
      <main className="home-main">
        <Fan />
        <motion.h1
          className="wordmark"
          initial={{ opacity: 0, y: 12, letterSpacing: '0.12em' }}
          animate={{ opacity: 1, y: 0, letterSpacing: '0.02em' }}
          transition={{ duration: 1.1, ease: [0.23, 1, 0.32, 1] }}
        >
          Cambio
        </motion.h1>
        <p className="home-lede">A memory card game for friends. Lowest hand wins.</p>

        <form
          className="home-form"
          onSubmit={(e) => {
            e.preventDefault();
            go(code.length === 4 ? code : null);
          }}
        >
          <label className="field">
            <span>Your name</span>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={18}
              autoComplete="nickname"
              placeholder="What should the table call you?"
              autoFocus={!name}
            />
          </label>
          {invited ? (
            <button className="btn btn-primary btn-wide" disabled={!name.trim() || busy}>
              {busy ? 'Joining…' : `Join table ${code}`}
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary btn-wide" disabled={!name.trim() || busy} onClick={() => go(null)}>
                {busy ? 'Opening…' : 'Open a new table'}
              </button>
              <div className="join-row">
                <input
                  id="code"
                  className="code-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
                  placeholder="CODE"
                  aria-label="Table code"
                  autoCapitalize="characters"
                />
                <button className="btn btn-ghost" disabled={!name.trim() || code.length !== 4 || busy}>
                  Join
                </button>
              </div>
            </>
          )}
        </form>
      </main>
      <RulesButton limit={3} />
    </div>
  );
}

export function Lobby({ room, you }: { room: RoomView; you: string }) {
  const host = room.hostId === you;
  const [copied, setCopied] = useState(false);
  const link = `${location.origin}${location.pathname}?table=${room.code}`;
  const ready = room.members.filter((m) => m.isBot || m.connected).length >= 2;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* the link stays visible to copy by hand */
    }
  };
  return (
    <div className="home lobby">
      <div className="felt" />
      <div className="grain" />
      <main className="lobby-main">
        <span className="eyebrow">Table</span>
        <motion.h1 className="table-code" initial={{ opacity: 0, letterSpacing: '0.5em' }} animate={{ opacity: 1, letterSpacing: '0.28em' }} transition={{ duration: 0.9 }}>
          {room.code}
        </motion.h1>
        <div className="invite">
          <span className="invite-link">{link}</span>
          <button className="btn btn-ghost btn-sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <ul className="seats">
          <AnimatePresence initial={false}>
            {room.members.map((m) => (
              <motion.li
                key={m.id}
                layout
                className="seat-row"
                style={{ ['--hue' as string]: m.hue }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                <span className="plate-dot" />
                <span className="seat-name">
                  {m.name}
                  {m.id === you && <span className="seat-tag">you</span>}
                  {m.id === room.hostId && <span className="seat-tag">host</span>}
                  {m.isBot && <span className="seat-tag">bot</span>}
                  {!m.connected && <span className="seat-tag">away</span>}
                </span>
                {host && m.id !== you && (
                  <button className="seat-remove" onClick={() => net.send({ t: 'kick', id: m.id })} aria-label={`Remove ${m.name}`}>
                    <svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" /></svg>
                  </button>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>

        <div className="lobby-actions">
          {host ? (
            <>
              <button className="btn btn-ghost" onClick={() => net.send({ t: 'addBot' })} disabled={room.members.length >= 8}>
                Add a bot
              </button>
              <button className="btn btn-primary" onClick={() => net.send({ t: 'start' })} disabled={!ready}>
                Deal
              </button>
            </>
          ) : (
            <span className="results-wait">Waiting for {room.members.find((m) => m.id === room.hostId)?.name ?? 'the host'} to deal…</span>
          )}
        </div>
        <div className="lobby-foot">
          <button className="link-btn" onClick={() => net.leave()}>
            Leave
          </button>
        </div>
      </main>
      <RulesButton limit={3} />
    </div>
  );
}
