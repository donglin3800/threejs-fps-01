// Ember Yard — the map. A dusk-lit industrial yard: two lanes and a mid
// plaza joining the Ember spawn (south) to Site A (north-west), where the
// bomb goes. All art is procedural geometry plus canvas textures; nothing
// is fetched. buildMap returns the colliders, spawns, site and waypoint
// graph the simulation plays on.
import { BackSide, BoxGeometry, CanvasTexture, Color, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, RepeatWrapping, SRGBColorSpace, SphereGeometry } from 'three';
import { boxCollider, segmentBlocked } from './physics.js';

export const MAP = {
  minX: -32, maxX: 32, minZ: -22, maxZ: 22,
  site: { x: -19, z: -14, r: 5.5 },
  emberSpawn: { x: -24, z: 16, yaw: 0 },       // faces north, up the yard
  slateSpawn: { x: 24, z: -15, yaw: Math.PI },  // faces south, down the yard
};

function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 4;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

function concreteTexture() {
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#6b655c'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 90 + Math.random() * 50;
      g.fillStyle = `rgba(${v},${v - 6},${v - 14},${0.12 + Math.random() * 0.2})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.strokeStyle = 'rgba(40,36,30,0.55)'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke();
    }
    // faded painted guide lines
    g.strokeStyle = 'rgba(240,168,48,0.5)'; g.lineWidth = 5;
    g.setLineDash([26, 18]);
    g.beginPath(); g.moveTo(60, 470); g.lineTo(452, 40); g.stroke();
    g.setLineDash([]);
  }, 8, 6);
}

function crateTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#8a6b42'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7d5f38';
    for (let y = 0; y < 4; y++) g.fillRect(0, y * 64, w, 30);
    g.strokeStyle = '#5d4526'; g.lineWidth = 6;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.beginPath(); g.moveTo(4, 4); g.lineTo(w - 4, h - 4); g.moveTo(w - 4, 4); g.lineTo(4, h - 4); g.stroke();
    g.fillStyle = 'rgba(240,168,48,0.85)';
    g.font = 'bold 34px sans-serif'; g.fillText('EM-04', 58, 140);
  });
}

function hazardTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#e8b73a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c1a17';
    for (let i = -4; i < 9; i++) {
      g.beginPath();
      g.moveTo(i * 48, h); g.lineTo(i * 48 + 48, 0);
      g.lineTo(i * 48 + 96, 0); g.lineTo(i * 48 + 48, h);
      g.fill();
    }
  }, 4, 4);
}

function wallTexture() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#57534c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#4c4841';
    for (let y = 0; y < 4; y++) g.fillRect(0, y * 64 + 56, w, 8);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = `rgba(20,18,14,${Math.random() * 0.25})`;
      g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
    }
    g.fillStyle = 'rgba(240,168,48,0.75)';
    g.font = 'bold 22px sans-serif'; g.fillText('YARD 7', 18, 40);
  }, 6, 1);
}

const WAYPOINTS = [
  // id, x, z, tags
  ['emberSpawn', -24, 16, 'spawn'],
  ['emberGate', -20, 8, ''],
  ['laneA1', -25, 2, 'A'],
  ['laneA2', -24, -6, 'A'],
  ['laneA3', -22, -11, 'A'],
  ['siteWest', -25, -15, 'site'],
  ['site', -19, -14, 'site'],
  ['siteEast', -13, -15, 'site'],
  ['midSouth', -6, 10, 'mid'],
  ['mid', 0, 2, 'mid'],
  ['midNorth', -2, -8, 'mid'],
  ['midEast', 8, 0, 'mid'],
  ['laneB1', 22, 8, 'B'],
  ['laneB2', 24, 0, 'B'],
  ['laneB3', 22, -8, 'B'],
  ['slateSpawn', 24, -15, 'spawn'],
  ['slateGate', 16, -14, ''],
  ['holdA', -14, -18, 'hold'],
  ['holdMid', 4, -12, 'hold'],
  ['holdB', 18, -17, 'hold'],
  ['connector', -8, -4, ''],
  ['connectorB', 12, 8, ''],
  ['yardSouth', 12, 14, ''],
  ['yardWest', -12, 14, ''],
];

export function buildMap(scene) {
  const solids = [];
  const group = new Group();
  scene.add(group);

  // --- sky, fog, lights -------------------------------------------------
  scene.background = new Color(0x2b2118);
  scene.fog = new Fog(0x2b2118, 55, 130);
  const hemi = new HemisphereLight(0xffd9a0, 0x2a2620, 0.85);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffb45e, 1.6);
  sun.position.set(-30, 42, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45; sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 120;
  scene.add(sun);
  // dusk gradient dome
  const skyTex = canvasTexture(64, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1c2438'); grad.addColorStop(0.45, '#7a4a33');
    grad.addColorStop(0.72, '#d97b3f'); grad.addColorStop(1, '#3a2a1c');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
  });
  const dome = new Mesh(
    new SphereGeometry(160, 24, 12),
    new MeshBasicMaterial({ map: skyTex, side: BackSide, fog: false }),
  );
  group.add(dome);

  // --- materials --------------------------------------------------------
  const groundMat = new MeshStandardMaterial({ map: concreteTexture(), roughness: 0.95, metalness: 0.02 });
  const wallMat = new MeshStandardMaterial({ map: wallTexture(), roughness: 0.9, metalness: 0.05 });
  const crateMat = new MeshStandardMaterial({ map: crateTexture(), roughness: 0.85 });
  const barrelMat = new MeshStandardMaterial({ color: 0x4a6b7a, roughness: 0.5, metalness: 0.55 });
  const barrelMat2 = new MeshStandardMaterial({ color: 0xb0703a, roughness: 0.5, metalness: 0.55 });
  const darkMetal = new MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.45, metalness: 0.7 });
  const rustMat = new MeshStandardMaterial({ color: 0x7a4a2e, roughness: 0.8, metalness: 0.3 });
  const hazardMat = new MeshStandardMaterial({ map: hazardTexture(), roughness: 0.9 });
  const windowMat = new MeshStandardMaterial({ color: 0x201a12, emissive: 0xffc46a, emissiveIntensity: 0.9, roughness: 0.4 });

  const addBox = (x, y, z, w, h, d, mat, collide = true) => {
    const m = new Mesh(new BoxGeometry(w, h, d), mat);
    m.position.set(x, y + h / 2, z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    if (collide) solids.push(boxCollider(x, y + h / 2, z, w / 2, h / 2, d / 2));
    return m;
  };
  const addCrate = (x, z, s = 1.2, y = 0) => {
    const m = new Mesh(new BoxGeometry(s, s, s), crateMat);
    m.position.set(x, y + s / 2, z);
    m.rotation.y = (x * 7 + z * 13) % 0.6;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    solids.push(boxCollider(x, y + s / 2, z, s / 2, s / 2, s / 2));
    return m;
  };
  const addBarrel = (x, z, mat = barrelMat) => {
    const m = new Mesh(new CylinderGeometry(0.45, 0.45, 1.1, 14), mat);
    m.position.set(x, 0.55, z);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    solids.push(boxCollider(x, 0.55, z, 0.45, 0.55, 0.45));
    return m;
  };

  // --- ground + site pad -------------------------------------------------
  const ground = new Mesh(new PlaneGeometry(70, 50), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  const pad = new Mesh(new PlaneGeometry(11, 11), hazardMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(MAP.site.x, 0.02, MAP.site.z);
  pad.receiveShadow = true;
  group.add(pad);

  // --- perimeter walls ----------------------------------------------------
  addBox(0, 0, MAP.minZ - 0.5, 66, 4.5, 1, wallMat);
  addBox(0, 0, MAP.maxZ + 0.5, 66, 4.5, 1, wallMat);
  addBox(MAP.minX - 0.5, 0, 0, 1, 4.5, 46, wallMat);
  addBox(MAP.maxX + 0.5, 0, 0, 1, 4.5, 46, wallMat);

  // --- buildings: warehouse (west-north), office (east-south) -------------
  addBox(-8, 0, -17, 12, 5, 6, rustMat);            // warehouse
  addBox(-8, 5, -17, 12, 0.4, 6.4, darkMetal);      // warehouse roof lip
  addBox(12, 0, 12, 10, 4, 7, wallMat);             // office block
  const winStrip = new Mesh(new PlaneGeometry(9, 0.8), windowMat);
  winStrip.position.set(12, 2.6, 8.4);
  group.add(winStrip);
  addBox(4, 0, -2, 3, 2.2, 3, darkMetal);           // mid kiosk / tank base
  const tank = new Mesh(new CylinderGeometry(1.6, 1.6, 2.6, 18), barrelMat2);
  tank.position.set(4, 1.3, -2);
  tank.castShadow = true;
  group.add(tank);

  // --- lane cover: crates, barrels, sandbag walls -------------------------
  // Lane A (west)
  addCrate(-27, 4); addCrate(-26.5, 4, 1.2, 1.2); addCrate(-21, -2);
  addCrate(-27, -9); addCrate(-18, -8); addBarrel(-24, -12); addBarrel(-23, -12.8, barrelMat2);
  addBox(-28.5, 0, -4, 1, 1.4, 6, rustMat);         // low wall, lane A
  // Mid plaza
  addCrate(-2, 6); addCrate(6, 5); addBarrel(2, 8); addBarrel(2.8, 8.6, barrelMat2);
  addBox(0, 0, -6, 5, 1.1, 0.8, rustMat);           // mid low wall
  addCrate(-6, -2);
  // Lane B (east)
  addCrate(20, 4); addCrate(26, 2); addCrate(21, -4); addBarrel(25, -6);
  addBarrel(18, -10, barrelMat2); addCrate(16, -8);
  addBox(28.5, 0, 2, 1, 1.4, 6, rustMat);           // low wall, lane B
  // Site A cover
  addCrate(-14, -10); addCrate(-24, -18); addBarrel(-16, -18, barrelMat2);
  addCrate(-22, -12, 1.2, 0); addBox(-12, 0, -19, 4, 1.1, 0.8, rustMat);
  // Spawn cover
  addCrate(-28, 12); addBarrel(28, -12); addCrate(28, 12);

  // --- floodlight poles ----------------------------------------------------
  const lampMat = new MeshStandardMaterial({ color: 0x111111, emissive: 0xffe2a8, emissiveIntensity: 2.2 });
  const polePositions = [[-28, -20], [28, -20], [0, 18], [-28, 18], [28, 18]];
  const lamps = [];
  for (const [px, pz] of polePositions) {
    const pole = new Mesh(new CylinderGeometry(0.09, 0.12, 7, 8), darkMetal);
    pole.position.set(px, 3.5, pz);
    group.add(pole);
    const lamp = new Mesh(new BoxGeometry(0.9, 0.25, 0.4), lampMat);
    lamp.position.set(px, 7, pz);
    group.add(lamp);
    const pt = new PointLight(0xffd9a0, 22, 26, 1.8);
    pt.position.set(px, 6.6, pz);
    group.add(pt);
    lamps.push(lamp);
  }

  // --- waypoint graph -------------------------------------------------------
  const nodes = WAYPOINTS.map(([id, x, z, tag]) => ({ id, x, z, tag }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = new Map();
  for (const n of nodes) edges.set(n.id, []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = a.x - b.x, dz = a.z - b.z;
      const d = Math.hypot(dx, dz);
      if (d > 15) continue;
      // straight walkable line at eye height, clear of colliders
      if (!segmentBlocked({ x: a.x, y: 1.0, z: a.z }, { x: b.x, y: 1.0, z: b.z }, solids)) {
        edges.get(a.id).push(b.id);
        edges.get(b.id).push(a.id);
      }
    }
  }

  return {
    colliders: solids, nodes, byId, edges, lamps,
    site: MAP.site,
    emberSpawn: MAP.emberSpawn,
    slateSpawn: MAP.slateSpawn,
    bounds: { minX: MAP.minX, maxX: MAP.maxX, minZ: MAP.minZ, maxZ: MAP.maxZ },
    update(dt, t) {
      // one lamp flickers faintly, a living yard
      const f = 2.0 + Math.sin(t * 13.7) * 0.12 + (Math.sin(t * 31) > 0.996 ? -0.5 : 0);
      lamps[2].material.emissiveIntensity = f;
    },
  };
}

// Breadth-first route through the waypoint graph.
export function findRoute(map, fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of map.edges.get(cur) || []) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        if (next === toId) {
          const path = [toId];
          let p = cur;
          while (p) { path.unshift(p); p = prev.get(p); }
          return path;
        }
        queue.push(next);
      }
    }
  }
  return [toId];
}

export function nearestNode(map, x, z) {
  let best = map.nodes[0], bd = Infinity;
  for (const n of map.nodes) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
