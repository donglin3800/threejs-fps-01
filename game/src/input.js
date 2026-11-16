// Ember Yard — keyboard and mouse state. One instance, owned by main.js.
// Pointer lock lives here too: the canvas requests it on click, and the
// accumulated mouse deltas are consumed once per simulation tick.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set(); // edge-triggered: keys pressed since the last tick
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.fire = false;       // left button held
    this.firePressed = false; // left button pressed this tick (edge)
    this.aim = false;        // right button held (scope)
    this.locked = false;
    this._onKeyDown = (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (e.button === 0) { this.fire = true; this.firePressed = true; }
      if (e.button === 2) this.aim = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.aim = false;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.fire = false; this.aim = false; }
    };
    this._onContext = (e) => e.preventDefault();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    document.addEventListener('pointerlockchange', this._onLockChange);
    canvas.addEventListener('contextmenu', this._onContext);
  }

  down(code) { return this.keys.has(code); }

  // True once per physical press, even if the key was released before the
  // next simulation tick (a quick tap must never be lost between ticks).
  wasPressed(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }

  clearPressed() { this.pressed.clear(); }

  // Consume this tick's mouse movement (radians already scaled by caller).
  takeMouse() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return { dx, dy };
  }

  takeFirePressed() {
    const v = this.firePressed;
    this.firePressed = false;
    return v;
  }

  takePointerLock() {
    if (this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* pointer lock needs a user gesture; the click handler retries */ }
  }

  dropPointerLock() {
    const held = document.pointerLockElement;
    if (held) document.exitPointerLock();
  }
}
