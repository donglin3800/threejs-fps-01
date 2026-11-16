// Ember Yard — bot brains. Defenders (SLATE) hold lanes and Site A, then
// converge to defuse once the bomb is down. Attackers (EMBER) run waypoint
// routes down A, mid or B, escort the carrier, and plant. Every bot sees
// through a cone + line of sight, hears gunfire, strafes while duelling,
// and fires in bursts after a human-like reaction delay.
import { TEAM } from './state.js';
import { weaponOf } from './weapons.js';
import { moveBody } from './physics.js';
import { eyeOf } from './player.js';
import { fireHitscan, startReload, updateReload, sightClear, tryPickupBomb } from './combat.js';
import { findRoute, nearestNode } from './map.js';

const EMBER_NAMES = ['Ash', 'Cinder', 'Flint'];
const SLATE_NAMES = ['Rook', 'Hale', 'Moss', 'Vane'];
const EMBER_ROUTES = [
  ['emberGate', 'laneA1', 'laneA2', 'laneA3', 'siteWest', 'site'],
  ['emberGate', 'midSouth', 'mid', 'midNorth', 'siteEast', 'site'],
  ['emberGate', 'yardSouth', 'connectorB', 'laneB1', 'laneB2', 'laneB3', 'siteEast', 'site'],
];
const SLATE_HOLDS = [
  ['holdA', 'laneA2'],
  ['holdMid', 'midNorth'],
  ['holdB', 'laneB3'],
  ['site', 'siteWest', 'siteEast'],
];

export function createBots(S, map) {
  const bots = [];
  for (let i = 0; i < 3; i++) {
    const f = makeBot(S, `ember-${i}`, EMBER_NAMES[i], TEAM.EMBER, map);
    bots.push(f);
  }
  for (let i = 0; i < 4; i++) {
    const f = makeBot(S, `slate-${i}`, SLATE_NAMES[i], TEAM.SLATE, map);
    bots.push(f);
  }
  return bots;
}

function makeBot(S, id, name, team, map) {
  const spawn = team === TEAM.EMBER ? map.emberSpawn : map.slateSpawn;
  const jx = (S.rng() - 0.5) * 3, jz = (S.rng() - 0.5) * 3;
  const f = {
    id, name, team,
    pos: { x: spawn.x + jx, y: 0, z: spawn.z + jz },
    vel: { x: 0, y: 0, z: 0 },
    yaw: spawn.yaw, pitch: 0,
    hp: 100, armor: 0, alive: true,
    crouch: false, onGround: true,
    radius: 0.38, height: 1.78,
    weapon: 'rifle', mag: 30, reserve: 999,
    owned: ['pistol', 'rifle', 'smg', 'marksman'], // bots use their assigned gun
    grenades: { frag: 0, smoke: 0 },
    money: 800, kills: 0, deaths: 0,
    brain: null,
    spread: 0, recoil: 0, lastShot: -9, reloadT: 0, reloading: false,
    fireHeld: false, aimT: 0, visibleT: 0, hurtT: 0, stepT: 0,
    lookYaw: spawn.yaw, lookPitch: 0,
    lastSeenPos: null, lastSeenT: -99,
    noisePos: null, noiseT: -99,
    spawnX: spawn.x, spawnZ: spawn.z, spawnYaw: spawn.yaw,
  };
  const skill = 0.45 + S.rng() * 0.4; // 0.45..0.85, higher is sharper
  f.brain = {
    skill,
    mode: 'route',
    route: [], routeIdx: 0,
    holdNodes: [], holdIdx: 0, holdT: 0,
    target: null, reactionT: 0, aimErr: 0.028 + (1 - skill) * 0.05,
    burstLeft: 0, burstT: 0, pauseT: 0,
    strafeDir: 1, strafeT: 0,
    percT: S.rng() * 0.1,
    scanYaw: 0, scanDir: 1,
    dest: null, arrived: false,
  };
  return f;
}

export function resetBotsForRound(S, map) {
  const emberBots = S.fighters.filter((f) => f.team === TEAM.EMBER && f !== S.player);
  const slateBots = S.fighters.filter((f) => f.team === TEAM.SLATE);
  emberBots.forEach((b, i) => {
    b.brain.route = [...EMBER_ROUTES[i % EMBER_ROUTES.length]];
    b.brain.routeIdx = 0;
    b.brain.mode = 'route';
    b.brain.target = null;
    b.weapon = i === 2 ? 'smg' : 'rifle';
    const w = weaponOf(b);
    b.mag = w.mag; b.reserve = 999;
  });
  slateBots.forEach((b, i) => {
    b.brain.holdNodes = [...SLATE_HOLDS[i % SLATE_HOLDS.length]];
    b.brain.holdIdx = 0;
    b.brain.mode = 'hold';
    b.brain.target = null;
    b.weapon = i === 3 ? 'marksman' : (i === 1 ? 'smg' : 'rifle');
    const w = weaponOf(b);
    b.mag = w.mag; b.reserve = 999;
  });
}

const _eye = { x: 0, y: 0, z: 0 };
const _tgt = { x: 0, y: 0, z: 0 };

function canSee(S, map, bot, enemy) {
  eyeOf(bot, _eye);
  _tgt.x = enemy.pos.x; _tgt.y = enemy.pos.y + 1.3; _tgt.z = enemy.pos.z;
  const dx = _tgt.x - _eye.x, dy = _tgt.y - _eye.y, dz = _tgt.z - _eye.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > 58) return null;
  // field of view: 105 degrees around the bot's facing
  const want = Math.atan2(-dx, -dz);
  let diff = want - bot.lookYaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  if (Math.abs(diff) > 0.92 && dist > 6) return null;
  if (!sightClear(_eye, _tgt, S, map)) return null;
  return { enemy, dist, dx, dy, dz };
}

function turnToward(bot, targetYaw, rate, dt) {
  let diff = targetYaw - bot.lookYaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
  bot.lookYaw += step;
  bot.yaw = bot.lookYaw;
  return Math.abs(diff) < 0.05;
}

// Walk toward a point with acceleration and wall sliding.
function walkTo(S, map, bot, x, z, speed, dt) {
  const dx = x - bot.pos.x, dz = z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) return true;
  const vx = (dx / d) * speed, vz = (dz / d) * speed;
  bot.vel.x += (vx - bot.vel.x) * Math.min(1, 10 * dt);
  bot.vel.z += (vz - bot.vel.z) * Math.min(1, 10 * dt);
  bot.vel.y -= 15 * dt;
  bot.onGround = moveBody(bot.pos, bot.radius, bot.height, bot.vel, dt, map.colliders);
  if (bot.onGround && bot.vel.y < 0) bot.vel.y = 0;
  // face the direction of travel while moving
  const want = Math.atan2(-(dx / d), -(dz / d));
  turnToward(bot, want, 5.5, dt);
  // footstep noise
  bot.stepT += Math.hypot(bot.vel.x, bot.vel.z) * dt;
  if (bot.stepT > 1.9 && bot.onGround) {
    bot.stepT = 0;
    S.events.push({ type: 'step', who: bot, run: false });
  }
  return d < 1.1;
}

function standStill(bot, dt) {
  bot.vel.x *= Math.max(0, 1 - 10 * dt);
  bot.vel.z *= Math.max(0, 1 - 10 * dt);
  bot.vel.y -= 15 * dt;
}

export function updateBot(S, map, bot, dt) {
  if (!bot.alive) return;
  const brain = bot.brain;
  updateReload(S, bot, dt);
  brain.percT -= dt;

  // --- perception, staggered ---------------------------------------------
  if (brain.percT <= 0) {
    brain.percT = 0.1 + S.rng() * 0.05;
    let best = null;
    for (const e of S.fighters) {
      if (!e.alive || e.team === bot.team) continue;
      const seen = canSee(S, map, bot, e);
      if (seen && (!best || seen.dist < best.dist)) best = seen;
    }
    if (best) {
      // A defender already on the bomb ignores distant gunfire and keeps
      // defusing; one still walking to the site fights back like anyone else.
      const b = S.bomb.pos;
      const onBomb = brain.mode === 'defuse' && b &&
        Math.hypot(bot.pos.x - b.x, bot.pos.z - b.z) < 4;
      const keepDefusing = onBomb && best.dist > 12;
      if (!keepDefusing) {
        if (!brain.target || brain.target !== best.enemy) {
          brain.reactionT = 0.65 - brain.skill * 0.35; // 0.3..0.47s to react
          brain.aimT = 0;
        }
        brain.target = best.enemy;
        bot.lastSeenPos = { x: best.enemy.pos.x, y: 0, z: best.enemy.pos.z };
        bot.lastSeenT = S.time;
        brain.mode = 'engage';
      } else {
        bot.lastSeenPos = { x: best.enemy.pos.x, y: 0, z: best.enemy.pos.z };
        bot.lastSeenT = S.time;
      }
    } else if (brain.mode === 'engage' && S.time - bot.lastSeenT > 2.2) {
      brain.target = null;
      brain.mode = 'investigate';
      brain.dest = bot.lastSeenPos;
    }
    // hearing: a recent shot or blast nearby pulls the bot over
    if (!brain.target && S.time - bot.noiseT < 1.2 && bot.noisePos) {
      const d = Math.hypot(bot.noisePos.x - bot.pos.x, bot.noisePos.z - bot.pos.z);
      if (d < 30 && brain.mode !== 'engage') {
        brain.mode = 'investigate';
        brain.dest = bot.noisePos;
      }
    }
  }

  // --- bomb-driven orders override the plan --------------------------------
  // Entering a bomb order drops any stale waypoint route, so the bot routes
  // fresh to the bomb instead of finishing an old patrol first.
  if (S.bomb.state === 'planted' && bot.team === TEAM.SLATE && brain.mode !== 'engage') {
    if (brain.mode !== 'defuse') { brain.mode = 'defuse'; brain.route = []; brain.routeIdx = 0; }
  }
  if (S.bomb.state === 'dropped' && bot.team === TEAM.EMBER && S.bomb.carrier === null) {
    if (brain.mode !== 'fetch') { brain.mode = 'fetch'; brain.route = []; brain.routeIdx = 0; }
    brain.dest = S.bomb.pos;
  }
  if (brain.mode === 'fetch' && S.bomb.state !== 'dropped') {
    brain.mode = 'hold'; brain.holdT = 0; brain.route = [];
  }
  if (S.bomb.state === 'carried' && S.bomb.carrier === bot) {
    brain.mode = 'route';
    if (brain.route[brain.route.length - 1] !== 'site') {
      brain.route = findRoute(map, nearestNode(map, bot.pos.x, bot.pos.z).id, 'site');
      brain.routeIdx = 0;
    }
  }

  // --- movement + aim by mode ----------------------------------------------
  const speed = 4.3;
  if (brain.mode === 'route') {
    bot.crouch = false;
    if (brain.routeIdx < brain.route.length) {
      const node = map.byId.get(brain.route[brain.routeIdx]);
      if (node && walkTo(S, map, bot, node.x, node.z, speed, dt)) brain.routeIdx++;
    } else {
      brain.mode = 'hold';
      brain.holdT = 0;
      brain.scanYaw = bot.lookYaw;
    }
  } else if (brain.mode === 'hold') {
    standStill(bot, dt);
    moveBody(bot.pos, bot.radius, bot.height, bot.vel, dt, map.colliders);
    brain.holdT += dt;
    // slow scan of the lane
    brain.scanYaw += brain.scanDir * 0.5 * dt;
    if (Math.abs(brain.scanYaw - bot.lookYaw) > 0.9) brain.scanDir *= -1;
    turnToward(bot, brain.scanYaw, 1.6, dt);
    bot.crouch = S.rng() < 0.002;
    if (brain.holdT > 9 && brain.holdNodes.length > 1) {
      brain.holdIdx = (brain.holdIdx + 1) % brain.holdNodes.length;
      const node = map.byId.get(brain.holdNodes[brain.holdIdx]);
      brain.mode = 'route';
      brain.route = findRoute(map, nearestNode(map, bot.pos.x, bot.pos.z).id, node.id);
      brain.routeIdx = 0;
      brain.holdT = 0;
    }
  } else if (brain.mode === 'investigate' || brain.mode === 'fetch') {
    bot.crouch = false;
    const dest = brain.dest;
    if (!dest) { brain.mode = 'hold'; brain.holdT = 0; }
    else {
      const node = nearestNode(map, dest.x, dest.z);
      if (!brain.route || brain.routeIdx >= brain.route.length) {
        brain.route = findRoute(map, nearestNode(map, bot.pos.x, bot.pos.z).id, node.id);
        brain.routeIdx = 0;
      }
      if (brain.routeIdx < brain.route.length) {
        const n = map.byId.get(brain.route[brain.routeIdx]);
        if (n && walkTo(S, map, bot, n.x, n.z, speed * 1.08, dt)) brain.routeIdx++;
      } else {
        const arrived = walkTo(S, map, bot, dest.x, dest.z, speed, dt);
        if (arrived || Math.hypot(dest.x - bot.pos.x, dest.z - bot.pos.z) < 1.2) {
          if (brain.mode === 'fetch') tryPickupBomb(S, bot);
          brain.mode = 'hold';
          brain.holdT = 0;
          brain.route = [];
        }
      }
    }
  } else if (brain.mode === 'defuse') {
    bot.crouch = false;
    const b = S.bomb.pos;
    if (b) {
      const d = Math.hypot(b.x - bot.pos.x, b.z - bot.pos.z);
      if (d > 1.6) {
        const node = nearestNode(map, b.x, b.z);
        if (!brain.route || brain.routeIdx >= brain.route.length) {
          brain.route = findRoute(map, nearestNode(map, bot.pos.x, bot.pos.z).id, node.id);
          brain.routeIdx = 0;
        }
        if (brain.routeIdx < brain.route.length) {
          const n = map.byId.get(brain.route[brain.routeIdx]);
          if (n && walkTo(S, map, bot, n.x, n.z, speed * 1.1, dt)) brain.routeIdx++;
        } else walkTo(S, map, bot, b.x, b.z, speed, dt);
      } else {
        standStill(bot, dt);
        moveBody(bot.pos, bot.radius, bot.height, bot.vel, dt, map.colliders);
        turnToward(bot, Math.atan2(-(b.x - bot.pos.x), -(b.z - bot.pos.z)), 4, dt);
      }
    } else brain.mode = 'hold';
  } else if (brain.mode === 'engage') {
    const t = brain.target;
    if (!t || !t.alive) { brain.target = null; brain.mode = 'investigate'; brain.dest = bot.lastSeenPos; return; }
    // face the target, strafe to stay unpredictable
    const dx = t.pos.x - bot.pos.x, dz = t.pos.z - bot.pos.z;
    const dist = Math.hypot(dx, dz) || 1;
    const want = Math.atan2(-dx, -dz);
    turnToward(bot, want, 7, dt);
    brain.strafeT -= dt;
    if (brain.strafeT <= 0) { brain.strafeDir *= -1; brain.strafeT = 0.5 + S.rng() * 0.8; }
    const px = -dz / dist, pz = dx / dist;
    let mx = px * brain.strafeDir * 2.2, mz = pz * brain.strafeDir * 2.2;
    if (dist < 7) { mx -= (dx / dist) * 2.4; mz -= (dz / dist) * 2.4; }
    if (dist > 24) { mx += (dx / dist) * 1.6; mz += (dz / dist) * 1.6; }
    bot.vel.x += (mx - bot.vel.x) * Math.min(1, 8 * dt);
    bot.vel.z += (mz - bot.vel.z) * Math.min(1, 8 * dt);
    bot.vel.y -= 15 * dt;
    bot.onGround = moveBody(bot.pos, bot.radius, bot.height, bot.vel, dt, map.colliders);
    if (bot.onGround && bot.vel.y < 0) bot.vel.y = 0;

    // fire control: react, then burst, then pause
    brain.reactionT -= dt;
    brain.aimT += dt;
    if (brain.reactionT <= 0 && !bot.reloading) {
      if (brain.burstLeft <= 0) {
        brain.pauseT -= dt;
        if (brain.pauseT <= 0) {
          brain.burstLeft = 3 + Math.floor(S.rng() * 3);
          brain.pauseT = 0.55 + S.rng() * 0.75;
        }
      }
      if (brain.burstLeft > 0) {
        brain.burstT -= dt;
        const w = weaponOf(bot);
        if (brain.burstT <= 0 && S.time - bot.lastShot >= 60 / w.rpm) {
          brain.burstT = 60 / w.rpm;
          if (bot.mag <= 0) { startReload(S, bot); brain.burstLeft = 0; }
          else {
            // aim with a skill-based error that grows with target speed
            const tSpeed = Math.hypot(t.vel.x, t.vel.z);
            const err = brain.aimErr * (1 + tSpeed * 0.12) * (1 + dist / 60);
            const lead = 0.12;
            const ax = t.pos.x + t.vel.x * lead - bot.pos.x;
            const az = t.pos.z + t.vel.z * lead - bot.pos.z;
            const ay = (t.pos.y + 1.25) - (bot.pos.y + 1.5);
            const ad = Math.hypot(ax, ay, az) || 1;
            bot.lookYaw = Math.atan2(-ax / ad, -az / ad) + (S.rng() - 0.5) * err * 2;
            bot.lookPitch = Math.asin(Math.max(-1, Math.min(1, ay / ad))) + (S.rng() - 0.5) * err;
            bot.yaw = bot.lookYaw;
            bot.mag--;
            bot.lastShot = S.time;
            bot.recoil = Math.min(0.06, bot.recoil + weaponOf(bot).recoil * 0.5);
            const hit = fireHitscan(S, bot, map, false);
            if (hit && hit.target === S.player) bot.visibleT = S.time;
            brain.burstLeft--;
          }
        }
      }
    }
    if (bot.mag <= 0 && !bot.reloading) startReload(S, bot);
  }

  // recoil decays; hearing memory fades
  bot.recoil = Math.max(0, bot.recoil - dt * 0.12);
  if (S.time - bot.noiseT > 4) bot.noisePos = null;
}

// Feed a loud event to every bot that could hear it.
export function hearNoise(S, pos, radius) {
  for (const f of S.fighters) {
    if (f === S.player || !f.alive || !f.brain) continue;
    const d = Math.hypot(f.pos.x - pos.x, f.pos.z - pos.z);
    if (d < radius) {
      f.noisePos = { x: pos.x, z: pos.z };
      f.noiseT = S.time;
    }
  }
}
