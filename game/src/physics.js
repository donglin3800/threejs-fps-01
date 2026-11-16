// Ember Yard — geometry queries. Axis-aligned boxes are the whole collision
// model: walls, crates, barrels and fighters are all AABBs (or a sphere
// tested against AABBs). No allocations in the hot paths: callers pass in
// scratch objects, and the helpers reuse module-level temporaries.
import { Box3, Ray, Vector3 } from 'three';

const _dir = new Vector3();
const _hit = new Vector3();
const _ray = new Ray(new Vector3(), new Vector3());
const _box = new Box3(new Vector3(), new Vector3());

// A collider: {min:{x,y,z}, max:{x,y,z}} in world space.
export function boxCollider(cx, cy, cz, hx, hy, hz) {
  return {
    min: { x: cx - hx, y: cy - hy, z: cz - hz },
    max: { x: cx + hx, y: cy + hy, z: cz + hz },
  };
}

export function pointInBox(p, b) {
  return p.x >= b.min.x && p.x <= b.max.x &&
    p.y >= b.min.y && p.y <= b.max.y &&
    p.z >= b.min.z && p.z <= b.max.z;
}

// Slide a standing body (feet position p, half extents r, height h) by vel*dt,
// resolving one axis at a time so it slides along walls instead of sticking.
export function moveBody(p, r, h, vel, dt, colliders) {
  // X axis
  p.x += vel.x * dt;
  for (const b of colliders) {
    if (p.y + h > b.min.y && p.y < b.max.y && p.z + r > b.min.z && p.z - r < b.max.z) {
      if (p.x + r > b.min.x && p.x - r < b.max.x) {
        p.x = vel.x > 0 ? b.min.x - r : b.max.x + r;
      }
    }
  }
  // Z axis
  p.z += vel.z * dt;
  for (const b of colliders) {
    if (p.y + h > b.min.y && p.y < b.max.y && p.x + r > b.min.x && p.x - r < b.max.x) {
      if (p.z + r > b.min.z && p.z - r < b.max.z) {
        p.z = vel.z > 0 ? b.min.z - r : b.max.z + r;
      }
    }
  }
  // Y axis (ground at y=0, plus standing on boxes)
  p.y += vel.y * dt;
  let grounded = false;
  if (p.y <= 0) { p.y = 0; grounded = true; }
  for (const b of colliders) {
    if (p.x + r > b.min.x && p.x - r < b.max.x && p.z + r > b.min.z && p.z - r < b.max.z) {
      if (vel.y <= 0 && p.y + h > b.min.y && p.y <= b.max.y && p.y > b.max.y - 0.6) {
        p.y = b.max.y; grounded = true;
      } else if (vel.y > 0 && p.y + h > b.min.y && p.y + h < b.max.y + 0.6) {
        p.y = b.min.y - h;
      }
    }
  }
  return grounded;
}

// Does the segment a->b cross any collider? Used for sight lines.
export function segmentBlocked(a, b, colliders) {
  _dir.set(b.x - a.x, b.y - a.y, b.z - a.z);
  const len = _dir.length();
  if (len < 1e-6) return false;
  _dir.divideScalar(len);
  _ray.origin.set(a.x, a.y, a.z);
  _ray.direction.copy(_dir);
  for (const c of colliders) {
    _box.min.set(c.min.x, c.min.y, c.min.z);
    _box.max.set(c.max.x, c.max.y, c.max.z);
    if (_ray.intersectBox(_box, _hit) !== null) {
      if (_hit.distanceTo(_ray.origin) < len - 0.05) return true;
    }
  }
  return false;
}

// Ray (origin, unit dir) against one fighter's body and head boxes.
// Returns {dist, head} for the nearest hit within maxDist, or null.
// Reuses scratch boxes; callers must not hold the result past the next call.
const _bodyBox = new Box3();
const _headBox = new Box3();
const _origin = new Vector3();
const _d = new Vector3();
const _h1 = new Vector3();
const _h2 = new Vector3();

export function rayHitFighter(origin, dir, maxDist, f) {
  _origin.set(origin.x, origin.y, origin.z);
  _d.set(dir.x, dir.y, dir.z);
  _ray.origin.copy(_origin);
  _ray.direction.copy(_d);
  const ray = _ray;
  const r = f.radius;
  const top = f.pos.y + f.height;
  const headTop = top;
  const headBottom = top - 0.30;
  _headBox.min.set(f.pos.x - r * 0.62, headBottom, f.pos.z - r * 0.62);
  _headBox.max.set(f.pos.x + r * 0.62, headTop, f.pos.z + r * 0.62);
  _bodyBox.min.set(f.pos.x - r, f.pos.y, f.pos.z - r);
  _bodyBox.max.set(f.pos.x + r, headBottom, f.pos.z + r);
  let best = null;
  if (ray.intersectBox(_headBox, _h1) !== null) {
    const d = _h1.distanceTo(_origin);
    if (d <= maxDist) best = { dist: d, head: true };
  }
  if (ray.intersectBox(_bodyBox, _h2) !== null) {
    const d = _h2.distanceTo(_origin);
    if (d <= maxDist && (!best || d < best.dist)) best = { dist: d, head: false };
  }
  return best;
}

// Ray against the map: nearest collider hit distance, or Infinity.
export function rayHitMap(origin, dir, maxDist, colliders) {
  _origin.set(origin.x, origin.y, origin.z);
  _d.set(dir.x, dir.y, dir.z);
  _ray.origin.copy(_origin);
  _ray.direction.copy(_d);
  const ray = _ray;
  let best = Infinity;
  for (const c of colliders) {
    _box.min.set(c.min.x, c.min.y, c.min.z);
    _box.max.set(c.max.x, c.max.y, c.max.z);
    if (ray.intersectBox(_box, _h1) !== null) {
      const d = _h1.distanceTo(_origin);
      if (d < best && d <= maxDist) best = d;
    }
  }
  // Ground plane
  if (dir.y < -1e-6) {
    const t = -origin.y / dir.y;
    if (t > 0 && t < best && t <= maxDist) best = t;
  }
  return best;
}
