# Ember Yard — a tactical FPS

[![make.fun bounty](https://make.fun/badge/threejs-fps-01.svg)](https://make.fun/bounty/threejs-fps-01)
[![rank](https://make.fun/badge/threejs-fps-01/donglin3800/threejs-fps-01/rank.svg)](https://make.fun/bounty/threejs-fps-01)
[![reward](https://make.fun/badge/threejs-fps-01/donglin3800/threejs-fps-01/reward.svg)](https://make.fun/bounty/threejs-fps-01)

A complete, original, round-based tactical first-person shooter that runs
offline from static files. Built with three.js 0.187.0 (vendored), no build
step, no network requests, no external assets: all art is procedural
geometry and canvas textures, all sounds are synthesized with WebAudio.

You are Ember, the attacking team, with three bot teammates. Fight through
lanes A, mid or B, plant the bomb at Site A and defend it until it blows —
or eliminate the four Slate defenders. First to 5 rounds takes the yard.

## What's in the game

- **Complete rounds** — buy phase, 100-second rounds, win/lose by elimination,
  bomb detonation, defuse or timeout; first to 5 wins the match, then rematch.
- **Gunplay** — hitscan weapons with headshot bonuses, recoil and spread that
  punish firing on the move, acceleration-based movement, crouching, jumping
  and AABB collision with the map. Standing still to aim pays.
- **Tactics** — bomb plant/defuse with progress bars and beeps, money earned
  per round (wins, kills, plants) spent in a buy menu (press B), four weapons
  (pistol, SMG, rifle, marksman rifle with scope), frag and smoke grenades,
  and bots that run waypoint routes, hold lanes, react to sight and sound,
  strafe in duels and converge to defuse.
- **Map and look** — "Ember Yard", an original dusk-lit industrial yard with
  two lanes, a mid plaza, a bombsite, crates, barrels, warehouses and
  floodlights, plus a live minimap, kill feed and full HUD (health, armour,
  ammo, money, timer, score, team status).
- **Code** — one job per module (`state`, `map`, `physics`, `weapons`,
  `audio`, `input`, `player`, `bots`, `combat`, `economy`, `hud`, `main`),
  a fixed 60 Hz simulation kept apart from rendering, pooled tracers and
  smoke, and a single central state object.

## How to run

```sh
node serve.ts
```

Then open <http://localhost:8080> in a desktop browser with WebGL 2.
Click to play (pointer lock). `WASD` move, mouse look, click fire,
`R` reload, `1`–`4` weapons, `G` frag, `H` smoke, `B` buy menu,
`E` hold to plant, `Ctrl` crouch, `Space` jump.

## How to hand in (make.fun)

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

That copies `game/` and `screenshots/` into the output directory and
writes `dossier.json` with the kit's `buildDossier`.

## License

MIT — see `LICENSE`.
