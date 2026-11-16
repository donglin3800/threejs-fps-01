// Ember Yard — central game state. One object owns every mutable fact about
// a match; modules read and write it, nobody keeps a private copy of it.
// Teams: EMBER attacks (the player), SLATE defends. First to 5 rounds wins.
export const TEAM = { EMBER: 0, SLATE: 1 };
export const PHASE = { MENU: 'menu', BUY: 'buy', LIVE: 'live', END: 'end', OVER: 'over' };
export const WIN_ROUNDS = 5;
export const ROUND_TIME = 100;
export const BUY_TIME = 14;
export const BOMB_TIME = 35;
export const PLANT_TIME = 3.5;
export const DEFUSE_TIME = 5.0;

// Seeded random for the match: a small xorshift stream, one 32-bit state
// word advanced per draw. Same seed, same match.
export function makeRandom(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return function () {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function createState(seed) {
  return {
    seed,
    rng: makeRandom(seed),
    phase: PHASE.MENU,
    phaseT: 0,          // seconds left in the current phase
    round: 1,
    score: [0, 0],      // rounds won, indexed by TEAM
    lossStreak: [0, 0], // consecutive round losses, for the economy
    fighters: [],       // player is fighters[0]; the rest are bots
    player: null,
    bomb: {
      state: 'carried', // carried | planted | exploded | defused | dropped
      carrier: null,    // fighter id carrying it
      pos: null,        // {x,y,z} when planted/dropped
      timer: 0,         // seconds to detonation once planted
      plantT: 0,        // planting progress 0..1
      defuseT: 0,       // defusing progress 0..1
      planter: null,
      defuser: null,
    },
    events: [],         // transient happenings this tick: shots, noises, kills
    killfeed: [],       // {text, team, t} newest first, capped
    messages: [],       // centre-screen announcements
    grenades: [],       // live thrown grenades {kind,pos,vel,t,smoke}
    smokes: [],         // active smoke clouds {pos, r, t}
    tracers: [],        // visual-only shot lines {a, b, t}
    flashes: [],        // muzzle flash lights {pos, t}
    decals: [],         // impact sparks {pos, t}
    time: 0,            // total match seconds (sim clock)
    roundWinner: -1,
    roundReason: '',
    matchWinner: -1,
    freezeInput: false, // true while an overlay owns the mouse
    stats: { shots: 0, hits: 0, kills: 0, headshots: 0, damage: 0 },
    shotStage: null,    // 'start' | 'play' | 'buy' | 'end' when ?shot= is set
  };
}

// A fighter is one body on the field, player or bot. pos is feet position.
export function makeFighter(id, name, team, x, z, yaw) {
  return {
    id, name, team,
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw, pitch: 0,
    hp: 100, armor: 0, alive: true,
    crouch: false, onGround: true,
    radius: 0.38, height: 1.78,
    weapon: 'pistol', mag: 12, reserve: 36,
    owned: ['pistol'], // guns bought this match; slots only switch to owned guns
    grenades: { frag: 0, smoke: 0 },
    money: 800,
    kills: 0, deaths: 0,
    // bot brain, unused for the player
    brain: null,
    // per-frame combat state
    spread: 0, recoil: 0, lastShot: -9, reloadT: 0, reloading: false,
    fireHeld: false, aimT: 0, visibleT: 0, hurtT: 0, stepT: 0,
    // where the fighter is looking (bots) / camera (player)
    lookYaw: yaw, lookPitch: 0,
    lastSeenPos: null, lastSeenT: -99,
    noisePos: null, noiseT: -99,
    spawnX: x, spawnZ: z, spawnYaw: yaw,
  };
}

export function aliveOf(S, team) {
  let n = 0;
  for (const f of S.fighters) if (f.alive && f.team === team) n++;
  return n;
}

export function pushKillfeed(S, text) {
  S.killfeed.unshift({ text, t: S.time });
  if (S.killfeed.length > 5) S.killfeed.length = 5;
}

export function announce(S, text, sub) {
  S.messages.unshift({ text, sub: sub || '', t: S.time });
  if (S.messages.length > 3) S.messages.length = 3;
}
