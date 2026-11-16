// Ember Yard — weapon and grenade tables. One entry per gun: everything the
// sim, the HUD and the buy menu need lives here, nowhere else.
export const WEAPONS = {
  pistol: {
    key: 'pistol', slot: 1, name: 'P9 Sidearm', short: 'P9',
    price: 0, damage: 34, headMult: 2.6, rpm: 340, auto: false,
    mag: 12, reserve: 36, reload: 1.4, range: 60,
    spreadBase: 0.006, spreadMove: 0.030, spreadAir: 0.05,
    recoil: 0.011, kick: 0.35, zoom: 1.0, tracer: 0xffd27a,
  },
  smg: {
    key: 'smg', slot: 2, name: 'VK-9 Jackal', short: 'VK-9',
    price: 1500, damage: 26, headMult: 2.4, rpm: 780, auto: true,
    mag: 30, reserve: 120, reload: 1.9, range: 55,
    spreadBase: 0.010, spreadMove: 0.038, spreadAir: 0.06,
    recoil: 0.009, kick: 0.28, zoom: 1.0, tracer: 0xffe9a8,
  },
  rifle: {
    key: 'rifle', slot: 3, name: 'AR-77 Longshot', short: 'AR-77',
    price: 2700, damage: 33, headMult: 2.5, rpm: 600, auto: true,
    mag: 30, reserve: 90, reload: 2.2, range: 90,
    spreadBase: 0.004, spreadMove: 0.034, spreadAir: 0.055,
    recoil: 0.013, kick: 0.5, zoom: 1.0, tracer: 0xfff2c0,
  },
  marksman: {
    key: 'marksman', slot: 4, name: 'MK-12 Needle', short: 'MK-12',
    price: 4750, damage: 82, headMult: 3.0, rpm: 48, auto: false,
    mag: 5, reserve: 15, reload: 2.8, range: 120,
    spreadBase: 0.0015, spreadMove: 0.09, spreadAir: 0.12,
    recoil: 0.045, kick: 1.6, zoom: 2.4, tracer: 0xcfe8ff,
  },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'marksman'];

export const GRENADES = {
  frag: {
    key: 'frag', name: 'Frag Grenade', price: 300,
    fuse: 1.6, radius: 9, damage: 110, falloff: 0.12,
  },
  smoke: {
    key: 'smoke', name: 'Smoke Canister', price: 300,
    fuse: 1.2, radius: 5.5, life: 16,
  },
};

export const ARMOR_PRICE = 650;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500; // per consecutive loss, up to 3

export function weaponOf(f) { return WEAPONS[f.weapon]; }

// Damage falls off gently past half the weapon's range.
export function rangeFalloff(w, dist) {
  if (dist <= w.range * 0.5) return 1;
  const t = Math.min(1, (dist - w.range * 0.5) / (w.range * 0.5));
  return 1 - 0.35 * t;
}
