import { motion } from 'motion/react';
import { useEffect } from 'react';
import { POWER_ORDER, POWERS, type Face } from '../../shared/cards';
import { CardFace } from './art';

const SAMPLE: Record<string, Face[]> = {
  joker: [{ rank: 'JK', suit: 'H' }],
  handSwap: [
    { rank: 'A', suit: 'S' },
    { rank: '2', suit: 'H' },
  ],
  drawAgain: [
    { rank: '3', suit: 'D' },
    { rank: '4', suit: 'C' },
  ],
  skip: [
    { rank: '5', suit: 'H' },
    { rank: '6', suit: 'S' },
  ],
  peekOwn: [
    { rank: '7', suit: 'C' },
    { rank: '8', suit: 'D' },
  ],
  peekOther: [
    { rank: '9', suit: 'S' },
    { rank: '10', suit: 'H' },
  ],
  blindSwap: [
    { rank: 'J', suit: 'D' },
    { rank: 'Q', suit: 'C' },
  ],
  lookSwap: [{ rank: 'K', suit: 'S' }],
};

export function MiniCard({ face, w = 38 }: { face: Face; w?: number }) {
  return (
    <span className="mini" style={{ width: w, height: w * 1.4 }}>
      <CardFace face={face} />
    </span>
  );
}

export function RulesSheet({ onClose, limit }: { onClose: () => void; limit: number }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    <motion.div className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        className="sheet rules"
        role="dialog"
        aria-label="House rules"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
      >
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <h2 className="sheet-title">House rules</h2>
        <p className="sheet-lede">Lowest hand wins. Remember what you’ve seen, and trust nobody’s memory but your own.</p>

        <h3>The rhymes</h3>
        <ul className="rhymes">
          {POWER_ORDER.map((k) => (
            <li key={k}>
              <span className="rhyme-cards">
                {SAMPLE[k].map((f, i) => (
                  <MiniCard key={i} face={f} />
                ))}
              </span>
              <span className="rhyme-words">
                <span className="rhyme-line">
                  <b>{POWERS[k].ranks}</b>, {POWERS[k].rhyme}
                </span>
                <span className="rhyme-rule">{POWERS[k].rule}</span>
              </span>
            </li>
          ))}
          <li>
            <span className="rhyme-cards">
              <MiniCard face={{ rank: 'K', suit: 'H' }} />
            </span>
            <span className="rhyme-words">
              <span className="rhyme-line">
                <b>Red K</b>, minus one
              </span>
              <span className="rhyme-rule">No power, but it’s worth −1.</span>
            </span>
          </li>
        </ul>

        <h3>A turn</h3>
        <p>
          Draw from the deck, or take the top discard and swap it into your hand. A card you draw can be swapped for one of yours
          (the old one goes to the discard) or thrown straight onto the discard. Only a card drawn from the deck and discarded
          straight away uses its power. Every power is optional except the Joker. If your hand is empty, you can keep the card you
          draw instead. When the deck runs out, the top discard stays put and the rest are shuffled into a new deck.
        </p>

        <h3>Flipping</h3>
        <p>
          Whenever a card lands on the discard pile, click any matching card on the table to flip it on, including onto your own
          discard. The first correct flip claims that discard: only that player can keep flipping onto it, and only from the same
          hand. Flip someone else’s card and you may give them one of yours for each. A wrong card goes back and you draw a
          penalty card.
        </p>

        <h3>Seven cards</h3>
        <p>
          Penalty cards pile up. Reach seven cards and you’re out of the round: you get no more turns, nobody can touch your hand,
          and you can’t win it. If everyone else goes out, the last player standing wins.
        </p>

        <h3>Cambio</h3>
        <p>
          When your hand is {limit} or less, a Cambio button appears at the start of your turn. Call it instead of drawing. Everyone
          else gets one more turn, then every card is turned over. The caller’s hand is locked. A 5 or 6 can skip the caller to give
          everyone another lap, and an A or 2 played on the caller cancels the call.
        </p>

        <h3>Scoring</h3>
        <p>
          A = 1, number cards at face value, J = 11, Q = 12, black K = 13, Joker = 0, red K = −1. The round’s lowest hand scores nothing;
          everyone else adds their total. A tie on points goes to whoever holds fewer cards. If the cards are level too, it’s a shared
          win, unless one of you called Cambio: the caller loses the tie. The match ends when someone reaches 100, and the lowest
          total wins.
        </p>
      </motion.div>
    </motion.div>
  );
}
