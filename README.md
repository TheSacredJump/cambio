# Cambio

A multiplayer, in-browser version of Cambio, the memory card game, with your house rules built in.

## Play

```bash
npm install
npm run build
npm start
```

The server prints two addresses:

- **This computer:** `http://localhost:3000`
- **Same Wi-Fi:** `http://192.168.x.x:3000`. Send this one to friends in the room.

Open a table, share the link (or the four-letter code), add bots to fill empty seats if you like, and deal. A table seats 2 to 8.

### Friends who aren't on your Wi-Fi

The server is a single Node process with no database, so any of these work:

- **Quick tunnel, no account:** keep `npm start` running, then `npx cloudflared tunnel --url http://localhost:3000`. Share the `https://….trycloudflare.com` URL it prints.
- **Host it:** deploy to Render, Railway, Fly.io or any Node host. Use `npm install && npm run build` as the build command, `npm start` as the start command, and let the host set `PORT`. WebSockets need to be allowed (they are by default on those three).

### Developing

`npm run dev` runs the server with reload on port 3000 and Vite on port 5173 (open that one). `npm test` runs the rules tests and a 280-round bot simulation. `npm run typecheck` checks types.

## House rules

Lowest hand wins. A = 1, number cards at face value, J = 11, Q = 12, black K = 13, Joker = 0, red K = −1.

**Setup.** Four cards face down in a 2×2 grid. Before play, each player looks at their nearest two once.

**A turn.** Draw from the deck, or take the top discard and swap it in. Swap the drawn card for one of yours (the old one goes to the discard), or discard it. Only a card drawn from the deck and discarded straight away uses its power. Powers are optional, except the Joker.

**The rhymes**

| Cards | Rhyme | Power |
| --- | --- | --- |
| Joker | Joker Poker | Every other player gives you a card. You see them all and deal them back out however you like. |
| A & 2 | start anew | Trade your whole hand with another player, blind. Played on the Cambio caller, it cancels their call instead. |
| 3 & 4 | try one more | Draw another card and play it. |
| 5 & 6 | play some tricks | Skip another player's next turn. A skipped player is immune for a round. Skipping the Cambio caller gives everyone another lap. |
| 7 & 8 | know your fate | Peek at one of your cards. |
| 9 & 10 | phone a friend | Peek at someone else's card. |
| J & Q | swap between | Swap any two cards on the table, unseen. |
| Black K | look and swap | Look at any two cards, then swap them if you like. |
| Red K | minus one | No power. Worth −1. |

**Flipping.** Whenever a card lands on the discard pile, click any matching card on the table to flip it on, including onto your own discard. The first correct flip claims that discard: only that player can keep flipping onto it, one click at a time, and only from the same hand, so you can't mix hands. Flip someone else's card and you may give them one of yours for each (click your card within a few seconds). A wrong card goes back after everyone has seen it, and you draw a penalty card.

**Seven cards.** Reach seven cards (usually from penalty cards) and you're out of the round: no more turns, your hand is frozen against swaps, flips, peeks and the Joker, and you can't win it. Your hand still counts toward your match total. If everyone else goes out, the last player standing wins the round.

**Cambio.** When your hand is 3 or less, a Cambio button appears at the start of your turn; call it instead of drawing. Everyone else gets one more turn, then all cards are turned over. The caller's hand is locked against swaps, flips and the Joker.

**Scoring.** The round's lowest hand scores 0; everyone else adds their hand. The match ends when someone reaches 100, and the lowest total wins.

### Choices made where the rules were silent

These follow the most common published Cambio rules:

- One card is turned up to start the discard pile; nobody can flip onto it.
- Taking the top discard is allowed, but it must be swapped in and its power doesn't trigger.
- If the deck runs out, the discards (all but the top card) are reshuffled into a new deck.
- Skip immunity lasts until the end of the skipped player's next turn.
- The Joker pool goes back one card per player, into the slot each card came from.

## How it's built

- `shared/game.ts` is the rules engine. It is server-authoritative and pure TypeScript, and only ever sends each player the cards they're allowed to see. Card ids are re-randomised on reshuffle so nobody can track a card through the deck.
- `shared/room.ts` handles seats, bots, autopilot for dropped players, and scoring across rounds. `shared/bot.ts` is the bot, which sees only what a human in its seat would see.
- `server/index.ts` is a small HTTP and WebSocket server.
- `client/` is React and [Motion](https://motion.dev). Cards are absolutely positioned and keyed by id, and travel on physics springs so a retargeted card keeps its momentum. They lift off the table in an arc, lean into their direction of travel, turn over with a 3D flip that has its own perspective, and settle on landing. A pacing queue keeps bursts of moves readable. Sounds are synthesized with WebAudio, so there are no audio files.
