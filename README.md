# Hack Team Builder

Mobile-first team planner for GBA Pokémon ROM hacks (Unbound, Emerald Rogue and
the like). Keep a roster of what you own, edit anything your hack changed, get a
scored team of six, and see who handles a given opponent best.

The Pokédex tab is the game's whole dex as a checklist: tick what you've caught,
tap one for its details in a pop-up. Best Team picks the strongest six from what
you've caught (defence and attack coverage), and Look For suggests what to catch
next, only from what your hack actually has and never anything needing a Master Ball.

Each game you play is its own **game setup**, with its own Pokédex, team and
opponent, capped at "Pokémon up to and including Gen N". The game's rules follow
the cap: a Gen 3 setup has no Fairy type, Gen 3 abilities (Gengar has Levitate),
no physical/special split and no Quick Ball. A setup can also use a hack's own
data (Unbound, Emerald Rogue): its species changes, extra forms and, for Unbound,
every boss team per difficulty, so the Opponent tab can show real damage numbers
from the boss's actual moves and level. Setups sync to the server, so your phone
and PC see the same games.

Built to the specification in [Design.md](Design.md).

## Running it

```sh
npm install
npm run sprites      # once: downloads sprites into public/sprites (not committed)
npm run build
npm start            # site + sync API on http://localhost:3000, saves in ./.data
```

For development, run `npm start` in one terminal and `npm run dev` in another;
Vite (http://localhost:5173) forwards `/api` to the server. Without the server the
app still works and keeps everything in the browser, showing *Offline*.

## Checks

```sh
npm run test         # unit tests: type chart, abilities, scoring, gen rules, storage, sync, server
npm run build        # typecheck + production build into dist/
npm run smoke        # drives a running app in a real browser at phone size
```

`npm run smoke` takes an optional URL (`npm run smoke -- http://localhost:8099`)
and uses the system Chromium; set `CHROME_PATH` to point elsewhere.

## Deploying

```sh
docker build -t hack-team-builder .
docker run -d -p 3000:3000 -v htb-data:/data -e ACCESS_CODE=choose-one hack-team-builder
```

One container, one Node process (`server/index.mjs`, no dependencies): it serves
the built site and the `/api/setups` sync API. Saved games are one JSON file each
in the `/data` volume, so **back up `htb-data`**.

- `ACCESS_CODE` is optional. When set, syncing needs it (the app asks once per
  device). Without it the API is open to anyone who can reach the port, which is
  fine on a home network and not on the internet.
- Sprites are downloaded during the image build. That layer is cached and only
  re-runs when `data/dex.json` changes.
- Hashed assets are cached for a year; `index.html` and `sw.js` are not, so a
  redeploy reaches everyone on their next load. A service worker precaches the
  shell and data, so the app keeps working offline; changes sync when it is back.
- Sync is last-write-wins per game setup, by modification time. Deleting a setup
  leaves a tombstone so another device's stale copy can't bring it back.

## Data

`data/*.json` is generated from the [PokeAPI](https://github.com/PokeAPI/pokeapi)
CSV dump and committed, so builds never need the network.

```sh
npm run build:data   # re-downloads (cached in scripts/.cache) and regenerates
```

Currently 1,133 entries, 648 damaging moves plus 18 "Any _type_ move"
placeholders for hacks that retype or rename moves, and 25 natures. The counts
are asserted in `src/logic/smoke.test.ts`, so a change to the filter rules shows
up as a failing test rather than silently.

### Hack packs

```sh
npm run build:hacks  # after build:data; downloads pinned sources, writes data/hacks/*.json
```

Each pack holds only what differs from vanilla, keyed by name. Sources are the
upstream community projects that [romhackdex.net/credits](https://romhackdex.net/credits/)
lists, fetched at pinned commits; nothing is taken from romhackdex itself.

| Hack | Source | Licence |
| --- | --- | --- |
| Unbound species and level-up moves | [Skeli789/Dynamic-Pokemon-Expansion](https://github.com/Skeli789/Dynamic-Pokemon-Expansion/tree/Unbound) (Unbound branch) | WTFPL |
| Unbound boss teams | [Owakeningowl/unbound-calc](https://github.com/Owakeningowl/unbound-calc), from SkiDY's Unbound fork of the Smogon calc | none stated; personal, self-hosted use |
| Unbound locations | [nMckenryan/Borrius-Pokedex-Scraper](https://github.com/nMckenryan/Borrius-Pokedex-Scraper) `pokelocation.json` | none stated; personal, self-hosted use |
| Emerald Rogue species | [Pokabbie/pokeemerald-rogue](https://github.com/Pokabbie/pokeemerald-rogue) EX-v2.1 | none stated; personal, self-hosted use |

The build prints names it couldn't map (source typos like "Heatt Wave") and fails
if more than 2% of species are unmapped.

Saved rosters resolve by **name**, not index, so regenerating the data never
repoints an entry at the wrong species.

## Layout

| Path | What it is |
| --- | --- |
| `scripts/build-data.ts` | PokeAPI CSV → JSON generator |
| `scripts/build-hacks.ts` | Hack sources → `data/hacks/*.json` packs |
| `scripts/fetch-sprites.mjs` | Downloads sprites (modern, plus Emerald for Gen 3 setups) |
| `server/index.mjs` | Static site + sync API, the whole deployment |
| `scripts/sw-plugin.ts` | Build-time service worker generator |
| `src/logic/` | Pure scoring logic — no DOM, no Preact, fully unit tested |
| `src/ui/` | Preact components |
| `src/types.ts` | Shared domain types and the persisted roster shape |

## Scope

The Opponent tab estimates damage with the Gen 3+ formula (levels, stats, EVs,
natures, STAB, type, abilities, common boosting items); no critical hits,
weather, terrain or stat changes. Best Team scoring is type-based. Scoring weights are heuristic (Design.md section 8) and pinned by tests,
so they are safe to tune.

Pokémon is Nintendo's. This ships no ROM data; the vanilla data comes from
PokeAPI and hack data from the projects credited above.
