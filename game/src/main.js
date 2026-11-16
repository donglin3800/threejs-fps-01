// Ember Yard — bootstrap, fixed-step simulation, rendering. The sim runs at
// 60 Hz and never touches the DOM or the renderer; the render pass reads
// the state and draws it. Pointer lock, phases, sounds and screenshots
// staging (?shot=start|play|buy|end) are wired here.
import { AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera, PlaneGeometry, PointLight, Points, PointsMaterial, Scene, SphereGeometry, WebGLRenderer } from 'three';
import { createState, makeFighter, TEAM, PHASE, ROUND_TIME, BUY_TIME, announce } from './state.js';
import { buildMap } from './map.js';
import { Input } from './input.js';
import { SoundBank } from './audio.js';
import { Hud } from './hud.js';
import { stepPlayer, eyeOf } from './player.js';
import { createBots, resetBotsForRound, updateBot, hearNoise } from './bots.js';
import { fireHitscan, startReload, updateReload, switchWeapon, throwGrenade, updateGrenades, updateBomb, tryPickupBomb, checkRoundEnd, endRound, currentSpread } from './combat.js';
import { weaponOf, WEAPONS } from './weapons.js';
import { buyItem, botShop } from './economy.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') || 1337);
const SHOT = params.get('shot');

const sounds = new SoundBank();
const canvasHost = document.getElementById('stage');
function createRenderer() {
  const r = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  r.setSize(window.innerWidth, window.innerHeight);
  r.shadowMap.enabled = true;
  r.shadowMap.type = PCFShadowMap;
  return r;
}
const renderer = createRenderer();
canvasHost.appendChild(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.08, 300);
const map = buildMap(scene);

const S = createState(SEED);
S.shotStage = SHOT;

// --- fighters ---------------------------------------------------------------
const player = makeFighter('player', 'You', TEAM.EMBER, map.emberSpawn.x, map.emberSpawn.z, map.emberSpawn.yaw);
S.player = player;
S.fighters.push(player);
for (const b of createBots(S, map)) S.fighters.push(b);
S.bomb.carrier = player;

const input = new Input(renderer.domElement);
const hud = new Hud(document,
  (id) => { if (buyItem(S, S.player, id)) { sounds.buy(); hud.renderBuy(S); } else sounds.denied(); },
  () => startMatch(),
  () => startMatch(),
);

// --- meshes ------------------------------------------------------------------
const fighterMeshes = new Map();
const EMBER_CLOTH = 0x5d7a4a, SLATE_CLOTH = 0x7a4a44;
function buildFighterMesh(f) {
  const g = new Group();
  const cloth = new MeshStandardMaterial({ color: f.team === TEAM.EMBER ? EMBER_CLOTH : SLATE_CLOTH, roughness: 0.85 });
  const skin = new MeshStandardMaterial({ color: 0xc9a184, roughness: 0.7 });
  const dark = new MeshStandardMaterial({ color: 0x23211e, roughness: 0.5, metalness: 0.4 });
  const legs = new Mesh(new CylinderGeometry(0.30, 0.34, 0.85, 10), cloth);
  legs.position.y = 0.43;
  const torso = new Mesh(new CylinderGeometry(0.33, 0.30, 0.62, 10), cloth);
  torso.position.y = 1.15;
  const vest = new Mesh(new BoxGeometry(0.56, 0.42, 0.34), dark);
  vest.position.set(0, 1.18, 0);
  const head = new Mesh(new SphereGeometry(0.21, 12, 10), skin);
  head.position.y = 1.62;
  const helm = new Mesh(new SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  helm.position.y = 1.64;
  const gun = new Mesh(new BoxGeometry(0.09, 0.12, 0.72), dark);
  gun.position.set(0.22, 1.25, -0.42);
  for (const m of [legs, torso, vest, head, helm, gun]) { m.castShadow = true; g.add(m); }
  g.userData = { gun, torso, head };
  scene.add(g);
  return g;
}
for (const f of S.fighters) {
  if (f !== player) fighterMeshes.set(f.id, buildFighterMesh(f));
}

// viewmodel gun (first person)
const viewGun = new Group();
const gunMat = new MeshStandardMaterial({ color: 0x55555c, roughness: 0.4, metalness: 0.45 });
const gunAccent = new MeshStandardMaterial({ color: 0x8a6b42, roughness: 0.7 });
function buildViewGun() {
  viewGun.clear();
  const w = weaponOf(player);
  const long = w.key === 'marksman' ? 0.85 : w.key === 'pistol' ? 0.3 : 0.62;
  const body = new Mesh(new BoxGeometry(0.09, 0.13, long), gunMat);
  body.position.z = -long / 2;
  const mag = new Mesh(new BoxGeometry(0.06, 0.16, 0.1), gunAccent);
  mag.position.set(0, -0.12, -0.18);
  const sight = new Mesh(new BoxGeometry(0.03, 0.05, 0.12), gunMat);
  sight.position.set(0, 0.09, -0.1);
  viewGun.add(body, mag, sight);
  if (w.key === 'marksman') {
    const scope = new Mesh(new CylinderGeometry(0.035, 0.035, 0.16, 10), gunMat);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.11, -0.22);
    viewGun.add(scope);
  }
  viewGun.position.set(0.32, -0.3, -0.5);
  viewGun.scale.setScalar(0.6);
}
buildViewGun();
camera.add(viewGun);
scene.add(camera);

// muzzle flash: one light + one quad, reused
const flashLight = new PointLight(0xffc46a, 0, 9, 1.6);
scene.add(flashLight);
const flashQuad = new Mesh(
  new PlaneGeometry(0.34, 0.34),
  new MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false }),
);
  flashQuad.position.set(0.32, -0.24, -1.0);
camera.add(flashQuad);

// tracer pool (24 lines, reused)
const tracerPool = [];
for (let i = 0; i < 24; i++) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
  const mat = new LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
  const line = new Line(geo, mat);
  line.frustumCulled = false;
  scene.add(line);
  tracerPool.push(line);
}
// smoke pool (4 spheres)
const smokePool = [];
for (let i = 0; i < 4; i++) {
  const m = new Mesh(
    new SphereGeometry(1, 18, 12),
    new MeshStandardMaterial({ color: 0xb8bcc0, transparent: true, opacity: 0, roughness: 1, depthWrite: false }),
  );
  m.visible = false;
  scene.add(m);
  smokePool.push(m);
}
// bomb mesh (planted / dropped)
const bombMesh = new Group();
const bombBody = new Mesh(new BoxGeometry(0.42, 0.26, 0.3), new MeshStandardMaterial({ color: 0x2a2d2a, roughness: 0.4, metalness: 0.6 }));
const bombLamp = new Mesh(new SphereGeometry(0.05, 8, 8), new MeshBasicMaterial({ color: 0xff3b30 }));
bombLamp.position.set(0.14, 0.16, 0);
bombMesh.add(bombBody, bombLamp);
bombMesh.visible = false;
scene.add(bombMesh);
// impact spark pool (points)
const SPARKS = 40;
const sparkGeo = new BufferGeometry();
sparkGeo.setAttribute('position', new BufferAttribute(new Float32Array(SPARKS * 3), 3));
const sparkPts = new Points(sparkGeo, new PointsMaterial({ color: 0xffd27a, size: 0.09, transparent: true, opacity: 0.9 }));
sparkPts.frustumCulled = false;
scene.add(sparkPts);

// --- match flow ---------------------------------------------------------------
function resetFighter(f, team) {
  const spawn = team === TEAM.EMBER ? map.emberSpawn : map.slateSpawn;
  f.pos.x = spawn.x + (S.rng() - 0.5) * 3;
  f.pos.y = 0;
  f.pos.z = spawn.z + (S.rng() - 0.5) * 3;
  f.vel.x = f.vel.y = f.vel.z = 0;
  f.yaw = spawn.yaw; f.lookYaw = spawn.yaw; f.pitch = 0; f.lookPitch = 0;
  f.hp = 100; f.alive = true; f.crouch = false;
  f.reloading = false; f.reloadT = 0; f.recoil = 0;
  if (f.brain) f.brain.target = null;
}

function startRound() {
  S.roundWinner = -1;
  S.roundReason = '';
  S.killfeed.length = 0;
  S.grenades.length = 0;
  S.smokes.length = 0;
  S.tracers.length = 0;
  for (const f of S.fighters) resetFighter(f, f.team);
  // weapons persist between rounds; the player keeps what they bought
  S.bomb = { state: 'carried', carrier: player, pos: null, timer: 0, plantT: 0, defuseT: 0, planter: null, defuser: null };
  resetBotsForRound(S, map);
  for (const f of S.fighters) if (f.brain) botShop(S, f);
  S.phase = PHASE.BUY;
  S.phaseT = BUY_TIME;
  hud.setPhase(PHASE.BUY);
  hud.setBuy(false);
  announce(S, `Round ${S.round} — buy phase`, 'Press B to open the shop');
  sounds.roundStart();
}

function startMatch(withLock = true) {
  sounds.ensure();
  S.score = [0, 0];
  S.lossStreak = [0, 0];
  S.round = 1;
  S.matchWinner = -1;
  S.stats = { shots: 0, hits: 0, kills: 0, headshots: 0, damage: 0 };
  for (const f of S.fighters) {
    f.money = 800;
    f.kills = 0; f.deaths = 0;
    f.weapon = 'pistol';
    f.owned = ['pistol'];
    const w = WEAPONS.pistol;
    f.mag = w.mag; f.reserve = w.reserve;
    f.grenades = { frag: 0, smoke: 0 };
    f.armor = 0;
  }
  buildViewGun();
  startRound();
  if (withLock) input.takePointerLock();
}

function nextRound() {
  if (S.matchWinner >= 0) {
    S.phase = PHASE.OVER;
    hud.setPhase(PHASE.OVER);
    hud.showMatchEnd(S);
    input.dropPointerLock();
    if (S.matchWinner === TEAM.EMBER) sounds.roundWin(); else sounds.roundLose();
    return;
  }
  S.round++;
  startRound();
}

// --- per-tick player input ------------------------------------------------------
const _in = { forward: 0, strafe: 0, jump: false, crouch: false, aim: false };
function readMoveInput() {
  _in.forward = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
  _in.strafe = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
  _in.jump = input.down('Space');
  _in.crouch = input.down('ControlLeft') || input.down('KeyC');
  _in.aim = input.aim;
  return _in;
}

function handlePlayerActions(dt) {
  const p = player;
  if (!p.alive) return;
  const w = weaponOf(p);
  // look
  const m = input.takeMouse();
  const sens = 0.0021 * (input.aim && w.key === 'marksman' ? 0.45 : 1);
  p.yaw -= m.dx * sens;
  p.pitch -= m.dy * sens;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
  p.lookYaw = p.yaw; p.lookPitch = p.pitch;
  // fire
  const wantFire = w.auto ? input.fire : input.takeFirePressed();
  if (wantFire && !p.reloading && S.phase === PHASE.LIVE && input.locked) {
    if (S.time - p.lastShot >= 60 / w.rpm) {
      if (p.mag > 0) {
        p.mag--;
        p.lastShot = S.time;
        p.recoil = Math.min(0.09, p.recoil + w.recoil);
        p.pitch += w.recoil * 0.55;
        p.yaw += (S.rng() - 0.5) * w.recoil * 0.35;
        p.lookYaw = p.yaw; p.lookPitch = p.pitch;
        S.stats.shots++;
        fireHitscan(S, p, map, input.aim);
        flashLight.position.set(p.pos.x - Math.sin(p.yaw) * 0.6, p.pos.y + 1.5, p.pos.z - Math.cos(p.yaw) * 0.6);
        flashLight.intensity = 14;
        flashQuad.material.opacity = 0.9;
        viewGun.position.z = -0.5 + w.kick * 0.09;
      } else {
        sounds.dryFire();
        startReload(S, p);
      }
    }
  }
  if (input.wasPressed('KeyR')) startReload(S, p);
  // weapon slots: switch only to a gun the player owns
  for (const key of ['pistol', 'smg', 'rifle', 'marksman']) {
    if (input.wasPressed('Digit' + WEAPONS[key].slot) && p.weapon !== key && p.owned.includes(key)) {
      if (switchWeapon(S, p, key)) buildViewGun();
    }
  }
  // grenades (edge-triggered: a tap always throws)
  if (input.wasPressed('KeyG')) throwGrenade(S, p, 'frag');
  if (input.wasPressed('KeyH')) throwGrenade(S, p, 'smoke');
  // buy menu
  if (input.wasPressed('KeyB')) {
    if (S.phase === PHASE.BUY) {
      hud.setBuy(!hud.buyOpen, S);
      if (hud.buyOpen) input.dropPointerLock(); else input.takePointerLock();
    }
  }
  // buy hotkeys while the shop is open
  if (hud.buyOpen && S.phase === PHASE.BUY) {
    for (let i = 1; i <= 7; i++) {
      if (input.wasPressed('Digit' + i)) {
        const items = document.querySelectorAll('#buy-list [data-buy]');
        const btn = items[i - 1];
        if (btn) {
          if (buyItem(S, p, btn.dataset.buy)) { sounds.buy(); hud.renderBuy(S); }
          else sounds.denied();
        }
      }
    }
  }
  input.clearPressed();
  // reload / spread bookkeeping (spread drives the crosshair gap)
  updateReload(S, p, dt);
  p.spread = currentSpread(p, input.aim);
  p.recoil = Math.max(0, p.recoil - dt * 0.09);
  // footstep sounds are raised as events by stepPlayer
}

// --- sound dispatch --------------------------------------------------------------
const _pp = { x: 0, y: 0, z: 0 };
function dispatchEvents() {
  for (const e of S.events) {
    eyeOf(player, _pp);
    const d = e.pos ? Math.hypot(e.pos.x - _pp.x, e.pos.y - _pp.y, e.pos.z - _pp.z) : 0;
    switch (e.type) {
      case 'shot': {
        const w = weaponOf(e.who);
        sounds.shot(w.key, e.who === player ? 0 : d);
        if (e.who !== player) hearNoise(S, e.pos, 30);
        break;
      }
      case 'explosion': sounds.explosion(); hearNoise(S, e.pos, 70); break;
      case 'step': if (e.who === player) sounds.step(e.run); break;
      case 'hit': hud.flashHit(false); sounds.hit(); break;
      case 'headshot': hud.flashHit(true); sounds.headshot(); break;
      case 'kill': sounds.kill(); break;
      case 'hurt': hud.damageFlash(); sounds.hurt(); break;
      case 'reloadStart': if (e.who === player) sounds.reloadStart(); break;
      case 'reloadEnd': if (e.who === player) sounds.reloadEnd(); break;
      case 'buy': sounds.buy(); break;
      case 'plantBeep': sounds.plantBeep(e.final); break;
      case 'defuseBeep': sounds.defuseBeep(); break;
      case 'pin': if (e.who === player) sounds.grenadePin(); break;
      case 'bounce': if (d < 18) sounds.bounce(); break;
      case 'roundWin': sounds.roundWin(); break;
      case 'roundLose': sounds.roundLose(); break;
      case 'planted': sounds.roundStart(); break;
      default: break;
    }
  }
  S.events.length = 0;
}

// --- fixed-step simulation ---------------------------------------------------------
function stepSim(dt) {
  S.time += dt;
  map.update(dt, S.time);
  if (S.phase === PHASE.BUY) {
    S.phaseT -= dt;
    readMoveInput();
    if (player.alive) stepPlayer(S, _in, dt, map.colliders);
    handlePlayerActions(dt);
    if (S.phaseT <= 0) {
      S.phase = PHASE.LIVE;
      S.phaseT = ROUND_TIME;
      hud.setPhase(PHASE.LIVE);
      hud.setBuy(false);
      input.takePointerLock();
      announce(S, `Round ${S.round} — live`, 'Eliminate Slate or plant at Site A');
    }
  } else if (S.phase === PHASE.LIVE) {
    S.phaseT -= dt;
    readMoveInput();
    if (player.alive) stepPlayer(S, _in, dt, map.colliders);
    handlePlayerActions(dt);
    for (const f of S.fighters) {
      if (f !== player && f.brain) updateBot(S, map, f, dt);
    }
    updateGrenades(S, map, dt);
    updateBomb(S, map, dt, input.down('KeyE'));
    for (const f of S.fighters) if (f.alive) tryPickupBomb(S, f);
    if (S.phase === PHASE.LIVE) {
      if (S.phaseT <= 0 && S.bomb.state !== 'planted') {
        endRound(S, TEAM.SLATE, 'Time expired — Site A held');
      } else if (S.phaseT <= 0 && S.bomb.state === 'planted') {
        S.phaseT = 0; // bomb timer decides now
      }
    }
    checkRoundEnd(S);
    // mark enemies the player can currently see (for the minimap)
    for (const f of S.fighters) {
      if (f.team === TEAM.SLATE && f.alive) {
        eyeOf(player, _pp);
        const dx = f.pos.x - _pp.x, dz = f.pos.z - _pp.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 55) {
          const want = Math.atan2(-dx, -dz);
          let diff = want - player.yaw;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (Math.abs(diff) < 0.85) {
            const a = { x: _pp.x, y: _pp.y, z: _pp.z };
            const b = { x: f.pos.x, y: f.pos.y + 1.3, z: f.pos.z };
            const dx2 = b.x - a.x, dy2 = b.y - a.y, dz2 = b.z - a.z;
            const len = Math.hypot(dx2, dy2, dz2);
            if (len < 60) {
              let hit = false;
              for (const c of map.colliders) {
                const t1 = (c.min.x - a.x) / (dx2 || 1e-6), t2 = (c.max.x - a.x) / (dx2 || 1e-6);
                const u1 = (c.min.y - a.y) / (dy2 || 1e-6), u2 = (c.max.y - a.y) / (dy2 || 1e-6);
                const v1 = (c.min.z - a.z) / (dz2 || 1e-6), v2 = (c.max.z - a.z) / (dz2 || 1e-6);
                const tmin = Math.max(Math.min(t1, t2), Math.min(u1, u2), Math.min(v1, v2));
                const tmax = Math.min(Math.max(t1, t2), Math.max(u1, u2), Math.max(v1, v2));
                if (tmax >= Math.max(tmin, 0) && tmin < 1) { hit = true; break; }
              }
              if (!hit) f.seenByPlayerT = S.time;
            }
          }
        }
      }
    }
  } else if (S.phase === PHASE.END) {
    S.phaseT -= dt;
    if (S.phaseT <= 0) nextRound();
  }
  if (S.phase !== PHASE.LIVE && S.phase !== PHASE.BUY) input.clearPressed();
  // decay transient visuals
  for (let i = S.tracers.length - 1; i >= 0; i--) {
    S.tracers[i].t -= dt;
    if (S.tracers[i].t <= 0) S.tracers.splice(i, 1);
  }
  for (let i = S.flashes.length - 1; i >= 0; i--) {
    S.flashes[i].t -= dt;
    if (S.flashes[i].t <= 0) S.flashes.splice(i, 1);
  }
  for (let i = S.decals.length - 1; i >= 0; i--) {
    S.decals[i].t -= dt;
    if (S.decals[i].t <= 0) S.decals.splice(i, 1);
  }
  dispatchEvents();
}

// --- rendering -----------------------------------------------------------------------
function render() {
  const p = player;
  if (S.phase === PHASE.MENU) {
    // slow orbit over the yard behind the menu
    const t = S.time * 0.08;
    camera.position.set(Math.sin(t) * 26, 16, Math.cos(t) * 18);
    camera.lookAt(-6, 1, -8);
    camera.fov = 60;
  } else {
    eyeOf(p, _pp);
    if (p.alive) {
      camera.position.set(_pp.x, _pp.y, _pp.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = p.yaw;
      camera.rotation.x = p.pitch;
      camera.rotation.z = 0;
    } else {
      camera.position.set(_pp.x, 0.55, _pp.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = p.yaw;
      camera.rotation.x = -0.25;
      camera.rotation.z = 0.3;
    }
    const w = weaponOf(p);
    const targetFov = input.aim && w.key === 'marksman' ? 75 / w.zoom : (input.aim ? 62 : 75);
    camera.fov += (targetFov - camera.fov) * 0.2;
  }
  camera.updateProjectionMatrix();

  // viewmodel bob + recoil recovery
  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  const bob = Math.min(1, hSpeed / 5) * (p.onGround ? 1 : 0);
  viewGun.position.x = 0.32 + Math.sin(S.time * 9) * 0.006 * bob;
  viewGun.position.y = -0.3 + Math.abs(Math.sin(S.time * 9)) * 0.008 * bob;
  // recoil offset decays back to rest
  viewGun.position.z = -0.5 + (viewGun.position.z + 0.5) * 0.82;
  viewGun.visible = p.alive && S.phase !== PHASE.MENU && S.phase !== PHASE.OVER;
  flashQuad.material.opacity *= 0.6;
  flashLight.intensity *= 0.55;

  // fighters
  for (const f of S.fighters) {
    if (f === player) continue;
    const m = fighterMeshes.get(f.id);
    if (!m) continue;
    m.visible = f.alive;
    if (!f.alive) continue;
    m.position.set(f.pos.x, f.pos.y, f.pos.z);
    m.rotation.y = f.yaw;
    const crouchScale = f.crouch ? 0.78 : 1;
    m.scale.set(1, crouchScale, 1);
    m.userData.gun.visible = true;
  }

  // tracers
  for (let i = 0; i < tracerPool.length; i++) {
    const line = tracerPool[i];
    const tr = S.tracers[i];
    if (tr) {
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, tr.a.x, tr.a.y, tr.a.z);
      pos.setXYZ(1, tr.b.x, tr.b.y, tr.b.z);
      pos.needsUpdate = true;
      line.material.color.setHex(tr.color);
      line.material.opacity = Math.min(1, tr.t / 0.09) * 0.85;
      line.visible = true;
    } else line.visible = false;
  }
  // smoke
  for (let i = 0; i < smokePool.length; i++) {
    const mesh = smokePool[i];
    const s = S.smokes[i];
    if (s) {
      mesh.visible = true;
      mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
      const grow = Math.min(1, (16 - s.t) / 1.5 + 0.4);
      mesh.scale.setScalar(s.r * grow);
      mesh.material.opacity = Math.min(0.82, s.t / 2.5) * 0.85;
    } else mesh.visible = false;
  }
  // bomb
  if ((S.bomb.state === 'planted' || S.bomb.state === 'dropped') && S.bomb.pos) {
    bombMesh.visible = true;
    bombMesh.position.set(S.bomb.pos.x, S.bomb.pos.y + 0.13, S.bomb.pos.z);
    bombLamp.material.color.setHex(Math.sin(S.time * (S.bomb.state === 'planted' ? 10 : 3)) > 0 ? 0xff3b30 : 0x550000);
  } else bombMesh.visible = false;
  // sparks
  {
    const pos = sparkGeo.attributes.position;
    for (let i = 0; i < SPARKS; i++) {
      const d = S.decals[i];
      if (d) pos.setXYZ(i, d.pos.x, d.pos.y, d.pos.z);
      else pos.setXYZ(i, 0, -10, 0);
    }
    pos.needsUpdate = true;
  }
  renderer.render(scene, camera);
}

// --- main loop ---------------------------------------------------------------------------
let last = performance.now();
let acc = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dtMs = Math.min(100, now - last);
  last = now;
  acc += dtMs / 1000;
  let n = 0;
  while (acc >= STEP && n < 5) {
    stepSim(STEP);
    acc -= STEP;
    n++;
  }
  if (n === 5) acc = 0;
  hud.update(S, map, dtMs / 1000);
  render();
}

function fitWindow() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
window.addEventListener('resize', fitWindow);

// click to (re)lock the pointer while playing
renderer.domElement.addEventListener('click', () => {
  sounds.ensure();
  if ((S.phase === PHASE.LIVE || S.phase === PHASE.BUY) && !hud.buyOpen) input.takePointerLock();
});

// --- shot staging: deterministic scenes for screenshots -------------------------------
function stageShot(kind) {
  if (kind === 'start') {
    S.phase = PHASE.MENU;
    hud.setPhase(PHASE.MENU);
    return;
  }
  startMatch(false); // staged scenes never grab the pointer
  // keep teammates out of the spawn camera's face for menu-style shots
  const scatter = () => {
    const spots = [[-14, 8], [-18, 4], [-10, 12], [-13, -12], [4, -10], [16, -14], [22, -8]];
    S.fighters.filter((f) => f !== player).forEach((f, i) => {
      f.pos.x = spots[i][0]; f.pos.z = spots[i][1];
      f.lookYaw = Math.PI * (0.9 + 0.1 * (i % 3)); f.yaw = f.lookYaw;
    });
  };
  if (kind === 'play') {
    // jump straight into a live round at a mid-lane vantage
    S.phase = PHASE.LIVE;
    S.phaseT = 88;
    hud.setPhase(PHASE.LIVE);
    player.weapon = 'rifle';
    player.mag = 30; player.reserve = 90;
    buildViewGun();
    player.pos.x = -4; player.pos.z = 14; player.pos.y = 0;
    player.yaw = Math.PI * 0.02; player.pitch = 0.02;
    player.lookYaw = player.yaw; player.lookPitch = player.pitch;
    // defenders in the lane ahead, close enough to read, facing the player
    const slate = S.fighters.filter((f) => f.team === TEAM.SLATE);
    slate[0].pos.x = -3; slate[0].pos.z = 2; slate[0].lookYaw = Math.PI; slate[0].yaw = Math.PI;
    slate[1].pos.x = 4; slate[1].pos.z = -1; slate[1].lookYaw = Math.PI * 0.92; slate[1].yaw = Math.PI * 0.92;
    slate[2].pos.x = 11; slate[2].pos.z = 5; slate[2].lookYaw = Math.PI * 1.1; slate[2].yaw = Math.PI * 1.1;
    const ember = S.fighters.filter((f) => f.team === TEAM.EMBER && f !== player);
    ember[0].pos.x = -7.5; ember[0].pos.z = 10; ember[0].lookYaw = 0.1; ember[0].yaw = 0.1;
    S.score = [1, 0];
    announce(S, 'Round 1 — live', 'Eliminate Slate or plant at Site A');
  } else if (kind === 'buy') {
    scatter();
    S.phase = PHASE.BUY;
    S.phaseT = 12;
    hud.setPhase(PHASE.BUY);
    hud.setBuy(true, S);
    player.money = 4200;
  } else if (kind === 'end') {
    scatter();
    S.phase = PHASE.LIVE;
    S.phaseT = 60;
    hud.setPhase(PHASE.LIVE);
    S.score = [1, 0];
    endRound(S, TEAM.EMBER, 'Slate team eliminated');
    hud.showRoundEnd(S);
  }
}

// --- boot ----------------------------------------------------------------------------------
// A debug handle for play-testing (bots, rounds, state) from automation.
window.__ember = { S, player, map };
if (SHOT) {
  stageShot(SHOT);
} else {
  S.phase = PHASE.MENU;
  hud.setPhase(PHASE.MENU);
}
hud.update(S, map, 0);
requestAnimationFrame(tick);
