// Ember Yard — the HUD: health, ammo, money, timer, score, team pips,
// kill feed, announcements, crosshair, damage flash, minimap, and the
// menu / buy / round-end / match-end overlays. It only renders state;
// main.js owns the game flow.
import { TEAM, PHASE } from './state.js';
import { weaponOf } from './weapons.js';
import { shopItems } from './economy.js';

export class Hud {
  constructor(doc, onBuy, onPlay, onRestart) {
    this.doc = doc;
    this.onBuy = onBuy;
    this.el = {};
    const ids = ['crosshair', 'hitmarker', 'health-num', 'health-bar', 'armor-num',
      'ammo-mag', 'ammo-reserve', 'weapon-name', 'money', 'timer', 'round-label',
      'score-ember', 'score-slate', 'alive-ember', 'alive-slate', 'killfeed',
      'announce', 'damage', 'minimap', 'bomb-status', 'interact', 'plant-bar',
      'plant-fill', 'plant-label', 'overlay-menu', 'overlay-buy', 'overlay-end',
      'overlay-over', 'buy-list', 'buy-money', 'end-title', 'end-reason',
      'end-score', 'over-title', 'over-score', 'play', 'restart', 'hint'];
    for (const id of ids) this.el[id] = doc.getElementById(id);
    this.mm = this.el['minimap'].getContext('2d');
    this.buyOpen = false;
    this.el['play'].addEventListener('click', () => onPlay());
    this.el['restart'].addEventListener('click', () => onRestart());
    this.el['overlay-buy'].addEventListener('click', (e) => {
      const btn = e.target.closest('[data-buy]');
      if (btn) this.onBuy(btn.dataset.buy);
    });
  }

  show(id, on) {
    const el = this.el[id];
    if (el) el.hidden = !on;
  }

  setPhase(phase) {
    this.show('overlay-menu', phase === PHASE.MENU);
    this.show('overlay-over', phase === PHASE.OVER);
    if (phase === PHASE.LIVE || phase === PHASE.BUY) this.show('overlay-end', false);
    if (phase !== PHASE.BUY) this.setBuy(false);
  }

  setBuy(open, S) {
    this.buyOpen = open;
    this.show('overlay-buy', open);
    if (open && S) this.renderBuy(S);
  }

  renderBuy(S) {
    const p = S.player;
    this.el['buy-money'].textContent = `$${p.money}`;
    const list = this.el['buy-list'];
    list.innerHTML = '';
    shopItems(p).forEach((item, i) => {
      const b = this.doc.createElement('button');
      b.type = 'button';
      b.dataset.buy = item.id;
      b.className = 'buy-item' + (item.owned ? ' owned' : '') + (p.money < item.price && !item.owned ? ' poor' : '');
      b.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${item.label}</span><span class="buy-detail">${item.detail}</span><span class="buy-price">$${item.price}</span>`;
      list.appendChild(b);
    });
  }

  flashHit(head) {
    const h = this.el['hitmarker'];
    h.classList.add('on');
    h.classList.toggle('head', !!head);
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => h.classList.remove('on'), 110);
  }

  damageFlash() {
    const d = this.el['damage'];
    d.style.opacity = '0.85';
    clearTimeout(this._dmgT);
    this._dmgT = setTimeout(() => { d.style.opacity = '0'; }, 260);
  }

  update(S, map, dt) {
    const p = S.player;
    if (!p) return;
    const w = weaponOf(p);
    this.el['health-num'].textContent = Math.max(0, Math.ceil(p.hp));
    this.el['health-bar'].style.width = `${Math.max(0, p.hp)}%`;
    this.el['health-bar'].classList.toggle('low', p.hp <= 30);
    this.el['armor-num'].textContent = p.armor > 0 ? `⛨ ${Math.ceil(p.armor)}` : '';
    this.el['ammo-mag'].textContent = p.reloading ? '--' : p.mag;
    this.el['ammo-reserve'].textContent = `/ ${p.reserve}`;
    this.el['weapon-name'].textContent = w.short;
    this.el['money'].textContent = `$${p.money}`;
    this.el['score-ember'].textContent = S.score[TEAM.EMBER];
    this.el['score-slate'].textContent = S.score[TEAM.SLATE];
    const mm = Math.max(0, Math.ceil(S.phaseT));
    this.el['timer'].textContent = S.phase === PHASE.LIVE || S.phase === PHASE.BUY
      ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}` : '--:--';
    this.el['round-label'].textContent = S.phase === PHASE.BUY ? `ROUND ${S.round} — BUY` : `ROUND ${S.round}`;
    this.el['alive-ember'].textContent = '●'.repeat(S.fighters.filter((f) => f.alive && f.team === TEAM.EMBER).length);
    this.el['alive-slate'].textContent = '●'.repeat(S.fighters.filter((f) => f.alive && f.team === TEAM.SLATE).length);

    // bomb status line
    const b = S.bomb;
    let bombText = '';
    if (b.state === 'carried') bombText = b.carrier === p ? '◉ YOU CARRY THE BOMB — reach Site A' : '◉ Bomb with ' + (b.carrier ? b.carrier.name : '?');
    else if (b.state === 'dropped') bombText = '◉ Bomb dropped — recover it';
    else if (b.state === 'planted') bombText = `◉ BOMB PLANTED — ${Math.max(0, b.timer).toFixed(0)}s to detonation`;
    else if (b.state === 'defused') bombText = '◉ Bomb defused';
    else if (b.state === 'exploded') bombText = '◉ Site A destroyed';
    this.el['bomb-status'].textContent = bombText;

    // plant / defuse progress + interact prompt
    const inSite = S.phase === PHASE.LIVE && b.state === 'carried' && b.carrier === p &&
      Math.hypot(p.pos.x - map.site.x, p.pos.z - map.site.z) < map.site.r;
    this.el['interact'].hidden = !inSite;
    if (inSite) this.el['interact'].textContent = 'HOLD E — PLANT THE BOMB';
    const planting = b.plantT > 0 && b.state === 'carried';
    const defusing = b.defuseT > 0 && b.state === 'planted';
    this.el['plant-bar'].hidden = !planting && !defusing;
    if (planting) {
      this.el['plant-label'].textContent = 'PLANTING…';
      this.el['plant-fill'].style.width = `${b.plantT * 100}%`;
    } else if (defusing) {
      this.el['plant-label'].textContent = 'DEFUSING…';
      this.el['plant-fill'].style.width = `${b.defuseT * 100}%`;
    }

    // kill feed
    const kf = this.el['killfeed'];
    const html = S.killfeed.map((k) => `<div>${k.text}</div>`).join('');
    if (kf._last !== html) { kf.innerHTML = html; kf._last = html; }

    // announcements (top centre, fade by age)
    const an = S.messages[0];
    if (an && S.time - an.t < 3.5) {
      this.el['announce'].innerHTML = `<b>${an.text}</b><span>${an.sub}</span>`;
      this.el['announce'].style.opacity = String(Math.min(1, (3.5 - (S.time - an.t)) / 0.5));
    } else this.el['announce'].style.opacity = '0';

    // crosshair gap follows spread: still = tight, moving/spraying = wide
    const gap = 6 + p.spread * 900;
    this.el['crosshair'].style.setProperty('--gap', `${Math.min(26, gap).toFixed(1)}px`);

    this.drawMinimap(S, map);
  }

  drawMinimap(S, map) {
    const g = this.mm;
    const W = 168, H = 124;
    const sx = W / (map.bounds.maxX - map.bounds.minX);
    const sz = H / (map.bounds.maxZ - map.bounds.minZ);
    const X = (x) => (x - map.bounds.minX) * sx;
    const Z = (z) => (z - map.bounds.minZ) * sz;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,14,12,0.72)';
    g.fillRect(0, 0, W, H);
    // walls and blocks
    g.fillStyle = 'rgba(233,230,223,0.4)';
    for (const c of map.colliders) {
      const w = (c.max.x - c.min.x) * sx, h = (c.max.z - c.min.z) * sz;
      if (c.max.y - c.min.y < 1.0) continue; // low cover stays off the map
      g.fillRect(X(c.min.x), Z(c.min.z), Math.max(1.5, w), Math.max(1.5, h));
    }
    // site
    g.strokeStyle = '#f0a830'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(X(map.site.x), Z(map.site.z), map.site.r * sx, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f0a830'; g.font = 'bold 11px sans-serif';
    g.fillText('A', X(map.site.x) - 4, Z(map.site.z) + 4);
    // fighters
    for (const f of S.fighters) {
      if (!f.alive) continue;
      const x = X(f.pos.x), y = Z(f.pos.z);
      if (f === S.player) {
        g.fillStyle = '#7ddb8a';
        g.save();
        g.translate(x, y); g.rotate(Math.PI - f.yaw);
        g.beginPath(); g.moveTo(0, -6); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.closePath(); g.fill();
        g.restore();
      } else if (f.team === TEAM.EMBER) {
        g.fillStyle = '#7ddb8a';
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      } else if (S.time - (f.seenByPlayerT || -99) < 1.5) {
        g.fillStyle = '#ff6a5e';
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill();
      }
    }
    // bomb
    if (S.bomb.state === 'planted' && S.bomb.pos) {
      g.fillStyle = '#ff3b30';
      g.beginPath(); g.arc(X(S.bomb.pos.x), Z(S.bomb.pos.z), 4, 0, Math.PI * 2); g.fill();
    } else if (S.bomb.state === 'dropped' && S.bomb.pos) {
      g.fillStyle = '#ffd27a';
      g.beginPath(); g.arc(X(S.bomb.pos.x), Z(S.bomb.pos.z), 3.5, 0, Math.PI * 2); g.fill();
    }
  }

  showRoundEnd(S) {
    const won = S.roundWinner === TEAM.EMBER;
    this.el['end-title'].textContent = won ? 'ROUND WON' : 'ROUND LOST';
    this.el['end-title'].className = won ? 'win' : 'lose';
    this.el['end-reason'].textContent = S.roundReason;
    this.el['end-score'].textContent = `Ember ${S.score[TEAM.EMBER]} — ${S.score[TEAM.SLATE]} Slate`;
    this.show('overlay-end', true);
  }

  showMatchEnd(S) {
    const won = S.matchWinner === TEAM.EMBER;
    this.el['over-title'].textContent = won ? 'VICTORY — EMBER TAKES THE YARD' : 'DEFEAT — SLATE HOLDS THE YARD';
    this.el['over-title'].className = won ? 'win' : 'lose';
    this.el['over-score'].textContent = `Final score  Ember ${S.score[TEAM.EMBER]} — ${S.score[TEAM.SLATE]} Slate   ·   Kills ${S.stats.kills} · Shots ${S.stats.shots} · Accuracy ${S.stats.shots ? Math.round(100 * S.stats.hits / S.stats.shots) : 0}%`;
    this.show('overlay-over', true);
  }
}
