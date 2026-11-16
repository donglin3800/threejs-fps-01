// Ember Yard — combat: hitscan shooting, reloads, grenades, the bomb and
// damage. Everything that changes hit points lives here. The shooter is any
// fighter (player or bot); targets are the fighters on the other team.
import { TEAM, PLANT_TIME, DEFUSE_TIME, BOMB_TIME, WIN_ROUNDS, pushKillfeed, announce, aliveOf } from './state.js';
import { weaponOf, rangeFalloff, KILL_REWARD, PLANT_REWARD, WIN_REWARD, LOSS_REWARD, LOSS_STREAK_BONUS } from './weapons.js';
import { rayHitFighter, rayHitMap, segmentBlocked } from './physics.js';
import { eyeOf, moveFactor } from './player.js';

const _eye = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 1 };
const _a = { x: 0, y: 0, z: 0 };
const _b = { x: 0, y: 0, z: 0 };

// Spread grows with movement and air time, shrinks when crouched or aiming.
export function currentSpread(f, aiming) {
  const w = weaponOf(f);
  let s = w.spreadBase + w.spreadMove * moveFactor(f);
  if (!f.onGround) s += w.spreadAir;
  if (f.crouch) s *= 0.7;
  if (aiming) s *= 0.45;
  s += f.recoil * 0.35;
  return s;
}

function lookDir(f, out) {
  const cp = Math.cos(f.lookPitch);
  out.x = -Math.sin(f.lookYaw) * cp;
  out.y = Math.sin(f.lookPitch);
  out.z = -Math.cos(f.lookYaw) * cp;
  return out;
}

// One hitscan shot. rng is the state's seeded random. Returns hit info or null.
export function fireHitscan(S, shooter, map, aiming) {
  const w = weaponOf(shooter);
  const spread = currentSpread(shooter, aiming);
  eyeOf(shooter, _eye);
  lookDir(shooter, _dir);
  // random point in a disc perpendicular to the aim direction
  const r = Math.sqrt(S.rng()) * spread;
  const th = S.rng() * Math.PI * 2;
  // basis: right = dir x up, up2 = right x dir
  let ux = 0, uy = 1, uz = 0;
  if (Math.abs(_dir.y) > 0.9) { ux = 1; uy = 0; uz = 0; }
  let rx = _dir.y * uz - _dir.z * uy;
  let ry = _dir.z * ux - _dir.x * uz;
  let rz = _dir.x * uy - _dir.y * ux;
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl; ry /= rl; rz /= rl;
  const qx = ry * _dir.z - rz * _dir.y;
  const qy = rz * _dir.x - rx * _dir.z;
  const qz = rx * _dir.y - ry * _dir.x;
  _dir.x += rx * Math.cos(th) * r + qx * Math.sin(th) * r;
  _dir.y += ry * Math.cos(th) * r + qy * Math.sin(th) * r;
  _dir.z += rz * Math.cos(th) * r + qz * Math.sin(th) * r;
  const dl = Math.hypot(_dir.x, _dir.y, _dir.z);
  _dir.x /= dl; _dir.y /= dl; _dir.z /= dl;

  const mapDist = rayHitMap(_eye, _dir, w.range * 1.6, map.colliders);
  let best = null, bestF = null;
  for (const t of S.fighters) {
    if (!t.alive || t.team === shooter.team) continue;
    const hit = rayHitFighter(_eye, _dir, Math.min(mapDist, w.range * 1.6), t);
    if (hit && (!best || hit.dist < best.dist)) { best = hit; bestF = t; }
  }
  const endDist = best ? best.dist : mapDist;
  const end = {
    x: _eye.x + _dir.x * endDist,
    y: _eye.y + _dir.y * endDist,
    z: _eye.z + _dir.z * endDist,
  };
  S.tracers.push({ a: { ..._eye }, b: end, t: 0.09, color: w.tracer });
  S.flashes.push({ pos: { ..._eye }, t: 0.05 });
  S.events.push({ type: 'shot', who: shooter, pos: { ..._eye }, dist: 0 });
  if (bestF) {
    const dmg = Math.round(w.damage * rangeFalloff(w, best.dist) * (best.head ? w.headMult : 1));
    applyDamage(S, bestF, dmg, best.head, shooter);
    return { target: bestF, head: best.head, damage: dmg, point: end };
  }
  if (Number.isFinite(mapDist) && mapDist < w.range * 1.6) {
    S.decals.push({ pos: end, t: 0.35 });
  }
  return null;
}

export function applyDamage(S, target, dmg, head, attacker) {
  if (!target.alive) return;
  let remaining = dmg;
  if (target.armor > 0) {
    const absorbed = Math.min(target.armor, Math.ceil(dmg * 0.5));
    target.armor -= absorbed;
    remaining = dmg - absorbed;
  }
  target.hp -= remaining;
  target.hurtT = 0.25;
  if (attacker === S.player) {
    S.stats.hits++;
    S.stats.damage += dmg;
    if (head) S.stats.headshots++;
    S.events.push({ type: head ? 'headshot' : 'hit', who: attacker });
  }
  if (target === S.player) S.events.push({ type: 'hurt', who: target });
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    if (attacker) {
      attacker.kills++;
      attacker.money += KILL_REWARD;
      if (attacker === S.player) {
        S.stats.kills++;
        S.events.push({ type: 'kill', who: attacker });
      }
    }
    pushKillfeed(S, `${attacker ? attacker.name : '—'}  ▸  ${target.name}${head ? '  ✕ headshot' : ''}`);
    S.events.push({ type: 'death', who: target, by: attacker });
    if (S.bomb.carrier === target) dropBomb(S, target);
    checkRoundEnd(S);
  }
}

export function startReload(S, f) {
  const w = weaponOf(f);
  if (f.reloading || f.mag >= w.mag || f.reserve <= 0) return false;
  f.reloading = true;
  f.reloadT = w.reload;
  S.events.push({ type: 'reloadStart', who: f });
  return true;
}

export function updateReload(S, f, dt) {
  if (!f.reloading) return;
  f.reloadT -= dt;
  if (f.reloadT <= 0) {
    const w = weaponOf(f);
    const need = w.mag - f.mag;
    const take = Math.min(need, f.reserve);
    f.mag += take;
    f.reserve -= take;
    f.reloading = false;
    S.events.push({ type: 'reloadEnd', who: f });
  }
}

export function switchWeapon(S, f, key) {
  const w = weaponOf({ weapon: key });
  if (!w || f.weapon === key) return false;
  f.weapon = key;
  f.mag = w.mag;
  f.reserve = w.reserve;
  f.reloading = false;
  f.recoil = 0;
  S.events.push({ type: 'switch', who: f });
  return true;
}

// --- grenades ------------------------------------------------------------
export function throwGrenade(S, f, kind) {
  if (f.grenades[kind] <= 0) return false;
  f.grenades[kind]--;
  eyeOf(f, _eye);
  lookDir(f, _dir);
  const g = kind === 'frag'
    ? { kind, pos: { ..._eye }, vel: { x: _dir.x * 17 + f.vel.x * 0.4, y: _dir.y * 17 + 3.4, z: _dir.z * 17 + f.vel.z * 0.4 }, t: 1.6, bounced: 0 }
    : { kind, pos: { ..._eye }, vel: { x: _dir.x * 14 + f.vel.x * 0.4, y: _dir.y * 14 + 3.8, z: _dir.z * 14 + f.vel.z * 0.4 }, t: 1.2, bounced: 0 };
  S.grenades.push(g);
  S.events.push({ type: 'pin', who: f });
  return true;
}

export function updateGrenades(S, map, dt) {
  for (let i = S.grenades.length - 1; i >= 0; i--) {
    const g = S.grenades[i];
    g.t -= dt;
    g.vel.y -= 12 * dt;
    const before = { ...g.pos };
    g.pos.x += g.vel.x * dt;
    g.pos.y += g.vel.y * dt;
    g.pos.z += g.vel.z * dt;
    // bounce off the ground and boxes, cheaply
    if (g.pos.y < 0.12) { g.pos.y = 0.12; g.vel.y = Math.abs(g.vel.y) * 0.42; g.vel.x *= 0.7; g.vel.z *= 0.7; S.events.push({ type: 'bounce', pos: { ...g.pos } }); }
    for (const c of map.colliders) {
      if (g.pos.x > c.min.x && g.pos.x < c.max.x && g.pos.y > c.min.y && g.pos.y < c.max.y && g.pos.z > c.min.z && g.pos.z < c.max.z) {
        g.pos = before;
        g.vel.x *= -0.4; g.vel.y *= 0.4; g.vel.z *= -0.4;
        S.events.push({ type: 'bounce', pos: { ...g.pos } });
        break;
      }
    }
    if (g.t <= 0) {
      S.grenades.splice(i, 1);
      if (g.kind === 'frag') detonateFrag(S, map, g.pos);
      else {
        S.smokes.push({ pos: { ...g.pos, y: Math.max(0.9, g.pos.y) }, r: 5.5, t: 16 });
        S.events.push({ type: 'smoke', pos: { ...g.pos } });
      }
    }
  }
  for (let i = S.smokes.length - 1; i >= 0; i--) {
    S.smokes[i].t -= dt;
    if (S.smokes[i].t <= 0) S.smokes.splice(i, 1);
  }
}

function detonateFrag(S, map, pos) {
  S.events.push({ type: 'explosion', pos: { ...pos }, big: false });
  S.flashes.push({ pos: { ...pos }, t: 0.25 });
  for (const f of S.fighters) {
    if (!f.alive) continue;
    const dx = f.pos.x - pos.x, dy = (f.pos.y + 1) - pos.y, dz = f.pos.z - pos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 9) continue;
    _a.x = pos.x; _a.y = pos.y; _a.z = pos.z;
    _b.x = f.pos.x; _b.y = f.pos.y + 1.2; _b.z = f.pos.z;
    if (segmentBlocked(_a, _b, map.colliders)) continue;
    const dmg = Math.round(110 * Math.max(0.12, 1 - d / 9));
    applyDamage(S, f, dmg, false, null);
  }
}

// --- sight with smoke ----------------------------------------------------
export function sightClear(a, b, S, map) {
  if (segmentBlocked(a, b, map.colliders)) return false;
  for (const s of S.smokes) {
    // segment-sphere test against the cloud
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = ((s.pos.x - a.x) * dx + (s.pos.y - a.y) * dy + (s.pos.z - a.z) * dz) / (len2 || 1);
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + dx * t, cy = a.y + dy * t, cz = a.z + dz * t;
    const d2 = (cx - s.pos.x) ** 2 + (cy - s.pos.y) ** 2 + (cz - s.pos.z) ** 2;
    if (d2 < s.r * s.r) return false;
  }
  return true;
}

// --- the bomb -------------------------------------------------------------
export function dropBomb(S, carrier) {
  S.bomb.state = 'dropped';
  S.bomb.carrier = null;
  S.bomb.pos = { x: carrier.pos.x, y: 0.15, z: carrier.pos.z };
  S.bomb.plantT = 0;
  announce(S, 'Bomb dropped', 'pick it up to carry on the attack');
}

export function tryPickupBomb(S, f) {
  if (S.bomb.state !== 'dropped' || !S.bomb.pos) return;
  const d = Math.hypot(f.pos.x - S.bomb.pos.x, f.pos.z - S.bomb.pos.z);
  if (d < 1.4) {
    S.bomb.state = 'carried';
    S.bomb.carrier = f;
    S.bomb.pos = null;
    if (f === S.player) announce(S, 'Bomb recovered', 'take it to Site A');
  }
}

export function bombSiteDist(S, map, f) {
  return Math.hypot(f.pos.x - map.site.x, f.pos.z - map.site.z);
}

// Called every tick while the round is live.
export function updateBomb(S, map, dt, plantHeldByPlayer) {
  const b = S.bomb;
  if (b.state === 'carried' && b.carrier) {
    const c = b.carrier;
    if (c.alive && bombSiteDist(S, map, c) < map.site.r && c.team === TEAM.EMBER) {
      const planting = c === S.player ? plantHeldByPlayer : true;
      if (planting) {
        b.plantT += dt / PLANT_TIME;
        b.planter = c;
        if (Math.floor(b.plantT * 10) !== Math.floor((b.plantT - dt / PLANT_TIME) * 10)) {
          S.events.push({ type: 'plantBeep', pos: { x: c.pos.x, y: 1, z: c.pos.z } });
        }
        if (b.plantT >= 1) {
          b.state = 'planted';
          b.timer = BOMB_TIME;
          b.pos = { x: c.pos.x, y: 0.15, z: c.pos.z };
          b.carrier = null;
          c.money += PLANT_REWARD;
          announce(S, 'Bomb planted', 'defend Site A until it blows');
          S.events.push({ type: 'planted', pos: { ...b.pos } });
        }
      } else b.plantT = Math.max(0, b.plantT - dt);
    } else b.plantT = Math.max(0, b.plantT - dt);
    return;
  }
  if (b.state === 'planted') {
    b.timer -= dt;
    const urgent = b.timer < 10;
    if (Math.floor(b.timer * 2) !== Math.floor((b.timer + dt) * 2)) {
      S.events.push({ type: 'plantBeep', final: urgent, pos: { ...b.pos } });
    }
    // a defender standing on the bomb defuses it
    let defuser = null;
    for (const f of S.fighters) {
      if (!f.alive || f.team !== TEAM.SLATE) continue;
      if (Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z) < 1.8) { defuser = f; break; }
    }
    if (defuser) {
      b.defuser = defuser;
      b.defuseT += dt / DEFUSE_TIME;
      if (Math.floor(b.defuseT * 8) !== Math.floor((b.defuseT - dt / DEFUSE_TIME) * 8)) {
        S.events.push({ type: 'defuseBeep', pos: { ...b.pos } });
      }
      if (b.defuseT >= 1) {
        b.state = 'defused';
        endRound(S, TEAM.SLATE, 'Bomb defused');
      }
    } else { b.defuser = null; b.defuseT = Math.max(0, b.defuseT - dt * 2); }
    if (b.timer <= 0 && b.state === 'planted') {
      b.state = 'exploded';
      S.events.push({ type: 'explosion', pos: { ...b.pos }, big: true });
      // The detonation decides the round first: the blast may wipe out the
      // attackers too, and that must not flip the result to elimination.
      endRound(S, TEAM.EMBER, 'Site A destroyed');
      for (const f of S.fighters) {
        if (!f.alive) continue;
        const d = Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z);
        if (d < 13) applyDamage(S, f, Math.round(160 * (1 - d / 16)), false, null);
      }
    }
  }
}

export function checkRoundEnd(S) {
  if (S.phase !== 'live') return;
  const ember = aliveOf(S, TEAM.EMBER);
  const slate = aliveOf(S, TEAM.SLATE);
  const planted = S.bomb.state === 'planted';
  if (ember === 0 && !planted) endRound(S, TEAM.SLATE, 'Ember team eliminated');
  else if (slate === 0 && !planted) endRound(S, TEAM.EMBER, 'Slate team eliminated');
  else if (slate === 0 && planted) endRound(S, TEAM.EMBER, 'Site A secured');
}

export function endRound(S, winner, reason) {
  if (S.phase !== 'live') return;
  S.phase = 'end';
  S.phaseT = 6;
  S.roundWinner = winner;
  S.roundReason = reason;
  S.score[winner]++;
  S.lossStreak[winner] = 0;
  const loser = 1 - winner;
  S.lossStreak[loser]++;
  for (const f of S.fighters) {
    const won = f.team === winner;
    f.money += won ? WIN_REWARD : LOSS_REWARD + Math.min(3, S.lossStreak[f.team] - (won ? 0 : 1)) * LOSS_STREAK_BONUS;
    if (f.money > 16000) f.money = 16000;
  }
  S.events.push({ type: winner === TEAM.EMBER ? 'roundWin' : 'roundLose' });
  announce(S, winner === TEAM.EMBER ? 'Round won' : 'Round lost', reason);
  if (S.score[winner] >= WIN_ROUNDS) {
    S.matchWinner = winner;
    S.phase = 'over';
    S.phaseT = 0;
  }
}
