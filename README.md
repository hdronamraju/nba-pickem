# Pick'em

Season win-total over/under for a small group of friends (3–10). One shared board per deployment, built on the Courtside 99 design system.

- Open the link, enter a name, pick OVER or UNDER on all 30 teams, then lock in. Locked picks can't change (the server enforces it).
- Picks stay hidden until you lock your own. After that you see who took which side, which teams are ON (both sides have a locked pick), and the pool per team.
- The over/unders are plain text on `/admin` (one team per line, nicknames OK). Whatever is saved there is what the site uses. They freeze once anyone locks in.
- The bet amount is a text box in your own browser. It only drives the dollar estimates on your screen and is never sent to the server.
- Win totals refresh from ESPN's standings about once a day. If a fetch fails, the last good numbers stay and the Payouts view says so.

## Run

```bash
npm start          # http://localhost:3000   (PORT=… to change)
npm test
```

No dependencies, Node 20+. State lives in `data/state.json` (or `$DATA_DIR/state.json`), so a deployed copy needs a persistent disk. `DISABLE_ESPN=1` skips the standings fetch. `ADMIN_PASSWORD=…` turns on `/admin`; without it the admin routes are off.

## Layout

- `server.js`: plain `node:http`, JSON file persistence, Server-Sent Events for live updates.
- `shared/logic.js`: ON/OFF, pools and payouts in integer cents. Used by the server tests and the browser.
- `shared/teams.js`: the 30 lines (Hoops Junkie). `shared/espn.js`: standings parser.
- `public/`: no-build front end. `tokens.css` is generated from the design system's `tokens.json`; `bundle.css` is its component stylesheet.

## Rules

- A team is ON only if at least one locked player took OVER and one took UNDER. Pool = bet × players on that team.
- OVER wins if wins > line (lines end in .5, so no pushes). Winners split the pool equally; leftover cents go to the first winners alphabetically.
- No accounts: your browser holds a token. Clear your site data and you lose your card.

## Deploy to Fly.io

Run exactly **one** machine: the JSON file is the database, and two machines would each keep their own copy.

```bash
# once: install flyctl, sign up at fly.io (needs a card, roughly $2-5/month), then
fly auth login

# from a clone of this repo
fly launch --no-deploy --ha=false --copy-config   # pick a unique app name; say No to Postgres/Redis
fly volumes create pickem_data --size 1 --region <the region fly launch chose> --count 1
fly secrets set ADMIN_PASSWORD='a-long-password'
fly deploy
```

Then open `https://<app>.fly.dev/admin`, enter the password, paste the over/unders, and save. Send friends `https://<app>.fly.dev/`.

- Redeploy any time with `fly deploy`; the volume (and everyone's picks) stays.
- Check it's one machine: `fly status`. If it shows two, `fly scale count 1`.
- Backups: Fly snapshots the volume daily (`fly volumes snapshots list`).
