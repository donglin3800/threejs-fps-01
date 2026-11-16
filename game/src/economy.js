// Ember Yard — money and the buy menu. Prices live in weapons.js; this
// module owns the transaction rules: what the player can afford, what a
// purchase changes, and the shop catalogue the HUD renders.
import { WEAPONS, WEAPON_ORDER, GRENADES, ARMOR_PRICE } from './weapons.js';

export function shopItems(f) {
  const catalogue = [];
  for (const key of WEAPON_ORDER) {
    const w = WEAPONS[key];
    catalogue.push({
      id: `gun:${key}`, kind: 'gun', key,
      label: w.name, detail: `$${w.price} · ${w.damage} dmg · ${w.mag} rounds`,
      price: w.price, owned: f.weapon === key,
    });
  }
  catalogue.push({
    id: 'grenade:frag', kind: 'grenade', key: 'frag',
    label: GRENADES.frag.name, detail: `$${GRENADES.frag.price} · owned ${f.grenades.frag}`,
    price: GRENADES.frag.price, owned: false,
  });
  catalogue.push({
    id: 'grenade:smoke', kind: 'grenade', key: 'smoke',
    label: GRENADES.smoke.name, detail: `$${GRENADES.smoke.price} · owned ${f.grenades.smoke}`,
    price: GRENADES.smoke.price, owned: false,
  });
  catalogue.push({
    id: 'armor', kind: 'armor', key: 'armor',
    label: 'Plated Vest', detail: `$${ARMOR_PRICE} · absorbs half of incoming damage`,
    price: ARMOR_PRICE, owned: f.armor >= 100,
  });
  return catalogue;
}

// Returns true when the purchase went through.
export function buyItem(S, f, id) {
  const item = shopItems(f).find((i) => i.id === id);
  if (!item || item.owned) return false;
  if (item.kind === 'grenade' && f.grenades[item.key] >= 2) return false;
  if (f.money < item.price) return false;
  f.money -= item.price;
  if (item.kind === 'gun') {
    f.weapon = item.key;
    const w = WEAPONS[item.key];
    f.mag = w.mag;
    f.reserve = w.reserve;
    f.reloading = false;
    if (!f.owned.includes(item.key)) f.owned.push(item.key);
  } else if (item.kind === 'grenade') {
    f.grenades[item.key]++;
  } else if (item.kind === 'armor') {
    f.armor = 100;
  }
  S.events.push({ type: 'buy', who: f });
  return true;
}

// Bots spend simply: richer bots upgrade to the rifle, and defenders buy a vest.
export function botShop(S, f) {
  if (f.money >= 2700 && f.weapon === 'pistol') {
    f.weapon = 'rifle';
    f.mag = WEAPONS.rifle.mag; f.reserve = 999;
  }
  if (f.money >= 650 && f.armor <= 0) { f.armor = 50; f.money -= 650; }
}
