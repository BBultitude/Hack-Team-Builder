# Hack Team Builder

Mobile-first team planner for GBA Pokémon ROM hacks (Unbound, Emerald Rogue and
the like). Keep a roster of what you own, edit anything your hack changed, get a
scored team of six, and see who handles a given opponent best.

Built to the specification in [Design.md](Design.md).

## Running it

```sh
npm install
npm run dev          # http://localhost:5173
```

## Checks

```sh
npm run test         # unit tests for the type chart, abilities and scoring
npm run build        # typecheck + production build into dist/
npm run smoke        # drives a running app in a real browser at phone size
```

`npm run smoke` takes an optional URL (`npm run smoke -- http://localhost:8099`)
and uses the system Chromium; set `CHROME_PATH` to point elsewhere.

## Deploying

```sh
docker build -t hack-team-builder .
docker run -d -p 8080:80 hack-team-builder
```

The image builds the static site and serves it from nginx. Hashed assets are
cached for a year; `index.html` and `sw.js` are not, so a redeploy reaches
everyone on their next load. A service worker precaches the shell and the data
files, so the app keeps working offline after the first visit.

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

Saved rosters resolve by **name**, not index, so regenerating the data never
repoints an entry at the wrong species.

## Layout

| Path | What it is |
| --- | --- |
| `scripts/build-data.ts` | PokeAPI CSV → JSON generator |
| `scripts/sw-plugin.ts` | Build-time service worker generator |
| `src/logic/` | Pure scoring logic — no DOM, no Preact, fully unit tested |
| `src/ui/` | Preact components |
| `src/types.ts` | Shared domain types and the persisted roster shape |

## Scope

Types and basic defender-side abilities only — no damage numbers, items,
weather or terrain. The opponent is assumed to attack with moves of its own
types. Scoring weights are heuristic (Design.md section 8) and pinned by tests,
so they are safe to tune.

Pokémon is Nintendo's. This ships no ROM data; the vanilla data comes from
PokeAPI.
