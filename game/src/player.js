// Ember Yard — the human player: acceleration-based movement, crouch,
// jump, and AABB collision. Runs inside the fixed-step simulation only;
// rendering reads the fighter's pos/yaw afterwards.
import { moveBody } from './physics.js';

export const WALK_SPEED = 5.4;
export const CROUCH_SPEED = 2.6;
export const AIM_SPEED = 3.4;
export const ACCEL_GROUND = 42;
export const ACCEL_AIR = 12;
export const FRICTION = 11;
export const JUMP_VEL = 5.6;
export const GRAVITY = 15;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;

// Move the player one fixed step. input: {forward, strafe, jump, crouch, aim}
export function stepPlayer(S, input, dt, colliders) {
  const p = S.player;
  if (!p.alive) return;
  const f = p;
  f.crouch = input.crouch;
  const speed = f.crouch ? CROUCH_SPEED : (input.aim ? AIM_SPEED : WALK_SPEED);
  const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
  // forward is -Z rotated by yaw; right is +X rotated by yaw
  let wx = (-sy) * input.forward + cy * input.strafe;
  let wz = (-cy) * input.forward + (-sy) * input.strafe;
  const len = Math.hypot(wx, wz);
  if (len > 1) { wx /= len; wz /= len; }
  const accel = f.onGround ? ACCEL_GROUND : ACCEL_AIR;
  f.vel.x += wx * accel * dt;
  f.vel.z += wz * accel * dt;
  // friction + speed clamp on the ground plane
  const hSpeed = Math.hypot(f.vel.x, f.vel.z);
  if (f.onGround) {
    const drop = Math.max(0, hSpeed - FRICTION * dt * (len > 0 ? 0.35 : 1));
    if (hSpeed > 0) { f.vel.x *= drop / hSpeed; f.vel.z *= drop / hSpeed; }
  }
  const capped = Math.hypot(f.vel.x, f.vel.z);
  if (capped > speed) {
    f.vel.x *= speed / capped;
    f.vel.z *= speed / capped;
  }
  if (input.jump && f.onGround) {
    f.vel.y = JUMP_VEL;
    f.onGround = false;
  }
  f.vel.y -= GRAVITY * dt;
  const height = f.crouch ? 1.32 : f.height;
  f.onGround = moveBody(f.pos, f.radius, height, f.vel, dt, colliders);
  if (f.onGround && f.vel.y < 0) f.vel.y = 0;
  // footstep sounds on a distance clock
  const stepLen = f.crouch ? 1.1 : 1.9;
  f.stepT += hSpeed * dt;
  if (f.stepT > stepLen && f.onGround && hSpeed > 1.5) {
    f.stepT = 0;
    S.events.push({ type: 'step', who: f, run: hSpeed > 4.5 });
  }
}

// Eye position for the camera / shooting origin.
export function eyeOf(f, out) {
  out.x = f.pos.x;
  out.y = f.pos.y + (f.crouch ? EYE_CROUCH : EYE_STAND);
  out.z = f.pos.z;
  return out;
}

// Current movement speed factor 0..1, used for spread.
export function moveFactor(f) {
  const h = Math.hypot(f.vel.x, f.vel.z);
  return Math.min(1, h / WALK_SPEED);
}
