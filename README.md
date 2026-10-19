# Pick'em

Season win-total over/under for a small group of friends (3–10). One shared board per deployment, built on the Courtside 99 design system.

- Open the link, enter a name, pick OVER or UNDER on all 30 teams, then lock in. Locked picks can't change (the server enforces it).
- Picks stay hidden until you lock your own. After that you see who took which side, which teams are ON (both sides have a locked pick), and the pool per team.
- The bet amount is a text box in your own browser. It only drives the dollar estimates on your screen and is never sent to the server.
- Win totals refresh from ESPN's standings about once a day. If a fetch fails, the last good numbers stay and the Payouts view says so.

## Run

```bash
npm start          # http://localhost:3000   (PORT=… to change)
npm test
```

No dependencies, Node 20+. State lives in `data/state.json` (gitignored), so give it a persistent disk if you deploy it. `DISABLE_ESPN=1` skips the standings fetch.

## Layout

- `server.js`: plain `node:http`, JSON file persistence, Server-Sent Events for live updates.
- `shared/logic.js`: ON/OFF, pools and payouts in integer cents. Used by the server tests and the browser.
- `shared/teams.js`: the 30 lines (Hoops Junkie). `shared/espn.js`: standings parser.
- `public/`: no-build front end. `tokens.css` is generated from the design system's `tokens.json`; `bundle.css` is its component stylesheet.

## Rules

- A team is ON only if at least one locked player took OVER and one took UNDER. Pool = bet × players on that team.
- OVER wins if wins > line (lines end in .5, so no pushes). Winners split the pool equally; leftover cents go to the first winners alphabetically.
- No accounts: your browser holds a token. Clear your site data and you lose your card.
