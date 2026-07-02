// Undertow UI — a thin renderer over the pure engine in src/engine/.

import {
  newGame, endDay, buyClaim, investigateClaim, forgeEvidence, sellClaim,
  leakClaim, layLow, retire, canRetire, inspectNpc, inspectClaim,
  claimStats, isClaimActive, CONFIG, FACTIONS, INFORMANTS,
} from '../engine/game.js';
import { createNetworkView } from './network.js';

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const seed = params.get('seed') || `harbor-${Math.floor(Math.random() * 1e6)}`;
const state = newGame(seed);
window.UNDERTOW = state; // console access for the curious

let claimsTab = 'market';
let mainTab = 'chronicle';
let chronicleSeen = 0;

const $ = (sel) => document.querySelector(sel);
const el = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstChild;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const network = createNetworkView($('#network-canvas'), state, onPickNpc);

// ---------------------------------------------------------------------------
// Render root
// ---------------------------------------------------------------------------
function render() {
  renderMeters();
  renderClaims();
  renderChronicle();
  renderFactions();
  renderInformants();
  renderNetworkControls();
  renderDebug();
  $('#day-label').textContent = `· Day ${state.day} · ${state.player.actionsLeft} acts left`;
  $('#btn-retire').hidden = !canRetire(state) || !!state.ending;
  if (state.ending) showEnding();
}

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------
function meterHtml(label, value, max, color, display) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<div class="meter ${label.toLowerCase()}">
    <div class="label"><span>${label}</span><span>${display ?? Math.round(value)}</span></div>
    <div class="bar"><i style="width:${pct}%;background:${color}"></i></div>
  </div>`;
}

function renderMeters() {
  const p = state.player;
  $('#meters').innerHTML =
    meterHtml('Coin', Math.min(p.coin, 600), 600, 'var(--accent)', p.coin) +
    meterHtml('Exposure', p.exposure, 100, p.exposure > 60 ? 'var(--danger)' : 'var(--cool)') +
    meterHtml('Notoriety', Math.min(state.city.notoriety, 100), 100, '#c47ac0') +
    meterHtml('Unrest', state.city.unrest, 100, state.city.unrest > 60 ? 'var(--danger)' : '#a86', `${Math.round(state.city.unrest)}`);
}

// ---------------------------------------------------------------------------
// Claims column
// ---------------------------------------------------------------------------
function claimsForTab() {
  if (claimsTab === 'market') return state.claims.filter((c) => c.status === 'market');
  if (claimsTab === 'portfolio') return state.claims.filter((c) => c.status === 'owned' || (c.status === 'sold' && c.soldTo.length < FACTIONS.length));
  // street: everything circulating in the city
  return state.claims
    .filter((c) => isClaimActive(c) || c.status === 'debunked')
    .sort((a, b) => claimStats(b).penetration - claimStats(a).penetration);
}

function accuracyVerdict(c) {
  if (!c.investigated) return null;
  const a = c.trueAccuracy;
  if (a >= 0.7) return `Verified: substantially true (${Math.round(a * 100)}%)`;
  if (a >= 0.45) return `Verified: embellished truth (${Math.round(a * 100)}%)`;
  if (a >= 0.2) return `Verified: mostly invention (${Math.round(a * 100)}%)`;
  return `Verified: fabrication (${Math.round(a * 100)}%)`;
}

function renderClaims() {
  const list = $('#claims-list');
  list.innerHTML = '';
  const claims = claimsForTab();
  if (!claims.length) {
    list.appendChild(el(`<div class="claim-card"><div class="meta">${
      claimsTab === 'market' ? 'Nothing on offer. Informants surface new material most days.'
      : claimsTab === 'portfolio' ? 'You hold nothing. Buy claims on the market.'
      : 'The city is quiet. It will not last.'}</div></div>`));
    return;
  }
  for (const c of claims) list.appendChild(claimCard(c));
}

function claimCard(c) {
  const stats = claimStats(c);
  const informant = INFORMANTS.find((x) => x.id === c.informant);
  const tags = [
    `<span class="tag topic-${c.topic}">${c.topic}</span>`,
    c.about !== 'city' && c.about !== 'player' ? `<span class="tag">re: ${esc(FACTIONS.find((f) => f.id === c.about)?.short ?? c.about)}</span>` : '',
    c.about === 'player' ? `<span class="tag debunked">about YOU</span>` : '',
    c.originId ? `<span class="tag mutation">mutation</span>` : '',
    c.status === 'debunked' ? `<span class="tag debunked">debunked</span>` : '',
    ...c.soldTo.map((fid) => `<span class="tag sold">sold: ${esc(FACTIONS.find((f) => f.id === fid).short)}</span>`),
  ].join(' ');

  const verdict = accuracyVerdict(c);
  const evidence = c.evidence.map((e) =>
    `<div class="evidence-line">◆ ${esc(e.name)} — quality ${e.quality}${e.forged ? `, detectability ${e.detectability}` : ' (genuine)'}</div>`).join('');

  const spread = c.status !== 'market'
    ? `<div class="beliefbar" title="fill = mean belief among the aware; tick = penetration">
         <i style="width:${stats.meanBelief * 100}%"></i>
         <span class="pen" style="left:${stats.penetration * 100}%"></span>
       </div>
       <div class="meta"><span>${Math.round(stats.penetration * 100)}% have heard it · mean belief ${stats.meanBelief.toFixed(2)} · ${stats.believers} believers</span></div>`
    : '';

  const card = el(`<div class="claim-card">
    <div class="headline" data-inspect="${c.id}">“${esc(c.headline)}”</div>
    <div class="meta">${tags}
      <span>spice ${c.spice.toFixed(1)}</span>
      ${c.status === 'market' ? `<span style="color:var(--accent)">${c.price} coin</span>` : ''}
      ${informant && c.status === 'market' ? `<span>via ${esc(informant.name)}</span>` : ''}
    </div>
    ${verdict ? `<div class="verdict">${verdict}</div>` : ''}
    ${evidence}
    ${spread}
    <div class="claim-actions"></div>
  </div>`);

  card.querySelector('[data-inspect]').addEventListener('click', () => showClaimModal(c.id));

  const actions = card.querySelector('.claim-actions');
  const btn = (label, fn, opts = {}) => {
    const b = el(`<button ${opts.primary ? 'class="primary"' : ''} ${opts.disabled ? 'disabled' : ''} title="${esc(opts.title || '')}">${label}</button>`);
    if (!opts.disabled) b.addEventListener('click', () => { const r = fn(); toast(r.msg); render(); });
    actions.appendChild(b);
  };

  const noActs = state.player.actionsLeft <= 0 || !!state.ending;
  if (c.status === 'market') {
    btn(`Buy · ${c.price}c`, () => buyClaim(state, c.id),
      { primary: true, disabled: noActs || state.player.coin < c.price });
  }
  if (c.status === 'owned') {
    if (!c.investigated) btn(`Investigate · ${CONFIG.player.investigateCost}c`, () => investigateClaim(state, c.id),
      { disabled: noActs || state.player.coin < CONFIG.player.investigateCost, title: 'Learn the claim\u2019s true accuracy' });
    if (!c.evidence.some((e) => e.forged)) btn('Forge evidence…', () => (showForgeModal(c.id), { msg: null }),
      { disabled: noActs, title: 'Higher quality moves belief harder; higher detectability courts debunking' });
  }
  if (c.status === 'owned' || (c.status === 'sold' && c.soldTo.length < FACTIONS.length)) {
    btn('Sell…', () => (showSellModal(c.id), { msg: null }), { primary: c.status === 'owned', disabled: noActs });
  }
  if (c.status === 'owned' || c.status === 'sold') {
    btn('Leak to the streets', () => leakClaim(state, c.id), { disabled: noActs, title: 'No payment, but the city starts chewing on it' });
  }
  return card;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
function modal(html) {
  const root = $('#modal-root');
  root.innerHTML = '';
  root.hidden = false;
  const m = el(`<div class="modal">${html}</div>`);
  root.appendChild(m);
  root.onclick = (ev) => { if (ev.target === root) closeModal(); };
  return m;
}
function closeModal() { $('#modal-root').hidden = true; $('#modal-root').innerHTML = ''; }

function showForgeModal(claimId) {
  const c = state.claims.find((x) => x.id === claimId);
  const m = modal(`<h3>Commission a forgery</h3>
    <div class="modal-sub">“${esc(c.headline)}” — quality moves belief; detectability invites a public debunking that will burn you with every buyer.</div>
    <div class="options"></div>
    <button class="cancel">Never mind</button>`);
  const opts = m.querySelector('.options');
  CONFIG.player.forgeTiers.forEach((t, i) => {
    const b = el(`<button ${state.player.coin < t.cost ? 'disabled' : ''}>
      ${t.name} — ${t.cost} coin
      <small>quality ${t.quality} · detectability ${t.detectability}</small>
    </button>`);
    b.addEventListener('click', () => { const r = forgeEvidence(state, claimId, i); toast(r.msg); closeModal(); render(); });
    opts.appendChild(b);
  });
  m.querySelector('.cancel').addEventListener('click', closeModal);
}

function showSellModal(claimId) {
  const c = state.claims.find((x) => x.id === claimId);
  const m = modal(`<h3>Sell the claim</h3>
    <div class="modal-sub">“${esc(c.headline)}” — the buyer's inner circle will be handed the story directly. They will act on what they come to believe, on their own schedule.</div>
    <div class="options"></div>
    <button class="cancel">Never mind</button>`);
  const opts = m.querySelector('.options');
  for (const f of FACTIONS) {
    const sold = c.soldTo.includes(f.id);
    const interested = f.interests.includes(c.topic) || c.about !== 'city';
    const b = el(`<button ${sold ? 'disabled' : ''}>
      ${esc(f.name)} ${sold ? '(already bought it)' : ''}
      <small>your credibility: ${Math.round(state.player.credibility[f.id])} / 100 · ${interested ? 'interested in this' : 'lukewarm on this topic'}</small>
    </button>`);
    if (!sold) b.addEventListener('click', () => { const r = sellClaim(state, claimId, f.id); toast(r.msg); closeModal(); render(); });
    opts.appendChild(b);
  }
  m.querySelector('.cancel').addEventListener('click', closeModal);
}

function sparkline(history, key, w = 220, h = 36) {
  if (history.length < 2) return '<span style="font-size:11px;color:var(--ink-faint)">(too young to chart)</span>';
  const pts = history.map((p, i) =>
    `${(i / Math.max(1, history.length - 1)) * w},${h - p[key] * (h - 4) - 2}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="var(--cool)" stroke-width="1.5"/></svg>`;
}

function showClaimModal(claimId) {
  const info = inspectClaim(state, claimId);
  if (!info) return;
  const { claim: c, stats, factionAggs, history } = info;
  const aggRows = factionAggs.map((a) =>
    `<div class="hl" style="display:flex;gap:8px"><b style="font-family:var(--mono);min-width:40px">${a.agg.toFixed(2)}</b> ${esc(a.name)} conviction</div>`).join('');
  const m = modal(`<h3>“${esc(c.headline)}”</h3>
    <div class="modal-sub">${c.topic} · ${c.status}${c.originId ? ` · mutated from a claim you may recognize` : ''}${c.investigated ? ` · true accuracy ${Math.round(c.trueAccuracy * 100)}%` : ' · true accuracy unknown (investigate to learn it)'}</div>
    <p style="font-size:13px;color:var(--ink-dim)">
      ${Math.round(stats.penetration * 100)}% of the city has heard this. Mean belief among them: ${stats.meanBelief.toFixed(2)}.
      ${stats.believers} people are convinced (≥ 0.6).
    </p>
    <p style="margin-top:8px">${sparkline(history, 'meanBelief')} <span style="font-size:11px;color:var(--ink-dim)">mean belief over time</span></p>
    <p>${sparkline(history, 'penetration')} <span style="font-size:11px;color:var(--ink-dim)">penetration over time</span></p>
    <div style="margin-top:10px;font-size:13px">${aggRows}</div>
    <p style="margin-top:12px;font-size:12px;color:var(--ink-dim)">A faction acts when its conviction crosses ${CONFIG.faction.actionThreshold}.</p>
    <div class="options" style="margin-top:12px">
      <button class="viewnet">View on the trust network</button>
    </div>
    <button class="cancel">Close</button>`);
  m.querySelector('.cancel').addEventListener('click', closeModal);
  m.querySelector('.viewnet').addEventListener('click', () => {
    closeModal();
    setMainTab('network');
    $('#network-claim').value = c.id;
    network.setClaim(c.id);
  });
}

// ---------------------------------------------------------------------------
// Chronicle
// ---------------------------------------------------------------------------
function renderChronicle() {
  const view = $('#chronicle-view');
  const entries = state.chronicle;
  // full rebuild grouped by day (cheap at this size), flag unseen as fresh
  view.innerHTML = '';
  let lastDay = null;
  entries.forEach((e, i) => {
    if (e.day !== lastDay) {
      lastDay = e.day;
      view.appendChild(el(`<div class="chron-day">Day ${e.day}</div>`));
    }
    const row = el(`<div class="chron-entry k-${e.kind} ${e.player ? 'player-flag' : ''} ${i >= chronicleSeen ? 'fresh' : ''}">
      <span class="kind">${e.kind}</span><span class="txt">${esc(e.text)}</span>
    </div>`);
    if (e.claimId) {
      row.querySelector('.txt').style.cursor = 'pointer';
      row.querySelector('.txt').title = 'Inspect this claim';
      row.querySelector('.txt').addEventListener('click', () => showClaimModal(e.claimId));
    }
    view.appendChild(row);
  });
  if (entries.length > chronicleSeen) view.scrollTop = view.scrollHeight;
  chronicleSeen = entries.length;
}

// ---------------------------------------------------------------------------
// Factions & informants
// ---------------------------------------------------------------------------
function renderFactions() {
  const panel = $('#factions-panel');
  panel.innerHTML = '';
  state.factions.forEach((fs, fi) => {
    const def = FACTIONS[fi];
    // hottest claims by this faction's conviction
    const hot = state.claims
      .filter((c) => isClaimActive(c) && c._factionAgg && c._factionAgg[def.id] > 0.2)
      .map((c) => ({ c, agg: c._factionAgg[def.id] }))
      .sort((a, b) => b.agg - a.agg)
      .slice(0, 3);
    const last = fs.lastActions[fs.lastActions.length - 1];
    const lastClaim = last && state.claims.find((c) => c.id === last.claimId);
    panel.appendChild(el(`<div class="faction-card">
      <h3 style="color:${def.color}">${esc(def.name)}</h3>
      <div class="desc">${esc(def.desc)}</div>
      <div class="statrow"><span>Power</span><span>${Math.round(fs.power)}</span></div>
      <div class="bar"><i style="width:${fs.power}%;background:${def.color}"></i></div>
      <div class="statrow"><span>Trusts you</span><span>${Math.round(state.player.credibility[def.id])}</span></div>
      <div class="bar"><i style="width:${state.player.credibility[def.id]}%;background:var(--ink-dim)"></i></div>
      ${hot.length ? `<div class="hotlist">${hot.map((h) =>
        `<div class="hl"><b>${h.agg.toFixed(2)}</b><span>${esc(h.c.headline.slice(0, 52))}${h.c.headline.length > 52 ? '…' : ''}</span></div>`).join('')}</div>` : ''}
      ${last ? `<div class="lastact">Last move (day ${last.day}): ${esc(last.action)}${lastClaim ? ` — over “${esc(lastClaim.headline.slice(0, 44))}…”` : ''}</div>` : ''}
    </div>`));
  });
}

function renderInformants() {
  const panel = $('#informants-panel');
  panel.innerHTML = '';
  for (const inf of INFORMANTS) {
    if (!state.player.unlockedInformants.has(inf.id)) continue;
    panel.appendChild(el(`<div class="informant">
      <span class="name">${esc(inf.name)}</span>
      <div class="desc">${esc(inf.desc)}</div>
    </div>`));
  }
}

// ---------------------------------------------------------------------------
// Network view + NPC inspector
// ---------------------------------------------------------------------------
function renderNetworkControls() {
  const sel = $('#network-claim');
  const current = sel.value;
  sel.innerHTML = '<option value="">— select a claim —</option>' + state.claims
    .filter((c) => isClaimActive(c) || c.status === 'debunked')
    .map((c) => `<option value="${c.id}">${esc(c.headline.slice(0, 70))}</option>`)
    .join('');
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  if (mainTab === 'network') network.draw();
}

$('#network-claim').addEventListener('change', (e) => network.setClaim(e.target.value || null));

function onPickNpc(npcId) {
  const box = $('#npc-inspector');
  if (npcId == null) { box.hidden = true; return; }
  const info = inspectNpc(state, npcId);
  const { npc, trusted, beliefs } = info;
  const fmt = (v) => (v >= 0 ? '+' : '') + v.toFixed(3);
  const cls = (v) => (v > 0.0005 ? 'pos' : v < -0.0005 ? 'neg' : '');
  const beliefRows = beliefs.slice(0, 6).map((b) => `
    <div class="why">
      <div style="font-size:12px">“${esc(b.headline.slice(0, 60))}” — <b>${b.belief.toFixed(2)}</b></div>
      <div class="row"><span>social pull</span><span class="${cls(b.lastTick.social)}">${fmt(b.lastTick.social)}</span></div>
      <div class="row"><span>decay to prior</span><span class="${cls(b.lastTick.decay)}">${fmt(b.lastTick.decay)}</span></div>
      <div class="row"><span>contradiction</span><span class="${cls(b.lastTick.contradiction)}">${fmt(b.lastTick.contradiction)}</span></div>
      <div class="row"><span>noise</span><span class="${cls(b.lastTick.noise)}">${fmt(b.lastTick.noise)}</span></div>
    </div>`).join('');
  const affinity = FACTIONS.map((f, i) => `${f.short} ${Math.round(npc.factionAffinity[i] * 100)}%`).join(' · ');
  box.innerHTML = `
    <span class="close">✕</span>
    <h3>${esc(npc.name)}</h3>
    <div class="sub">${npc.archetype} · gullibility ${npc.gullibility.toFixed(2)} · skepticism ${npc.skepticism.toFixed(2)} · influence ${npc.influence.toFixed(2)}<br>${affinity}</div>
    ${beliefs.length ? beliefRows : '<div class="sub">Holds no live beliefs. A blank slate, for now.</div>'}
    <div class="sub" style="margin-top:8px">Trusts most:</div>
    <table>${trusted.slice(0, 5).map((t) => `<tr><td>${esc(t.name)}</td><td>${t.trust.toFixed(2)}</td></tr>`).join('')}</table>`;
  box.hidden = false;
  box.querySelector('.close').addEventListener('click', () => { box.hidden = true; network.clearSelection(); });
}

// ---------------------------------------------------------------------------
// Debug view
// ---------------------------------------------------------------------------
function renderDebug() {
  if (mainTab !== 'debug') return;
  const q = state.eventQueue.map((e) => `  d${e.day} ${e.type} ${JSON.stringify(e.payload).slice(0, 90)}`).join('\n') || '  (empty)';
  const claims = state.claims.map((c) => {
    const st = claimStats(c);
    const aggs = c._factionAgg ? Object.entries(c._factionAgg).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ') : '';
    return `  ${c.id.padEnd(9)} ${c.status.padEnd(11)} pen=${(st.penetration).toFixed(2)} mean=${st.meanBelief.toFixed(2)} acc=${c.trueAccuracy.toFixed(2)} ${aggs}`;
  }).join('\n');
  $('#debug-view').innerHTML = `<h3>Seed</h3>${esc(String(state.seed))} (append ?seed=… to the URL to replay)
<h3>City</h3>  unrest=${state.city.unrest.toFixed(1)} notoriety=${state.city.notoriety} exposure=${state.player.exposure.toFixed(1)}
<h3>Factions</h3>${state.factions.map((f) => `  ${f.id.padEnd(9)} power=${f.power.toFixed(0)} stances=${JSON.stringify(f.stance)}`).join('\n')}
<h3>Event queue</h3>${esc(q)}
<h3>Claims</h3>${esc(claims)}
<h3>Valves fired</h3>  ${[...state.valvesFired].join(', ') || '(none)'}`;
}

// ---------------------------------------------------------------------------
// Tabs, toasts, ending
// ---------------------------------------------------------------------------
$('#claims-tabs').addEventListener('click', (e) => {
  if (e.target.dataset.tab) {
    claimsTab = e.target.dataset.tab;
    for (const b of $('#claims-tabs').children) b.classList.toggle('active', b === e.target);
    renderClaims();
  }
});

function setMainTab(tab) {
  mainTab = tab;
  for (const b of $('#main-tabs').children) b.classList.toggle('active', b.dataset.tab === tab);
  $('#chronicle-view').hidden = tab !== 'chronicle';
  $('#network-view').hidden = tab !== 'network';
  $('#debug-view').hidden = tab !== 'debug';
  if (tab === 'network') requestAnimationFrame(() => network.draw());
  if (tab === 'debug') renderDebug();
}
$('#main-tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) setMainTab(e.target.dataset.tab); });

let toastTimer = null;
function toast(msg) {
  if (!msg) return;
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

$('#btn-endday').addEventListener('click', () => {
  if (state.ending) return;
  endDay(state);
  render();
});
$('#btn-retire').addEventListener('click', () => {
  const r = retire(state);
  toast(r.msg);
  render();
});
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !e.target.closest('input,select,textarea') && $('#modal-root').hidden) {
    e.preventDefault();
    if (!state.ending) { endDay(state); render(); }
  }
  if (e.key === 'Escape') closeModal();
});

function showEnding() {
  const o = $('#ending-overlay');
  if (!o.hidden) return;
  const e = state.ending;
  const sold = state.claims.filter((c) => c.soldTo.length).length;
  const debunked = state.claims.filter((c) => c.status === 'debunked' && c.soldTo.length).length;
  const mutations = state.claims.filter((c) => c.originId).length;
  o.innerHTML = `<div class="card">
    <h2>${esc(e.title)}</h2>
    <p>${esc(e.text)}</p>
    <div class="stats">
      ${state.day} days · ${state.player.coin} coin · ${sold} claims sold · ${debunked} burned you · ${mutations} stories mutated beyond your control
    </div>
    <p style="font-size:13px;color:var(--ink-dim)">The chronicle on the left is the story you wrote. Nobody else will read it that way.</p>
    <button class="primary" onclick="location.search='?seed=harbor-'+Math.floor(Math.random()*1e6)">Begin again</button>
    <button class="ghost" onclick="document.getElementById('ending-overlay').hidden=true" style="margin-left:8px">Survey the wreckage</button>
  </div>`;
  o.hidden = false;
}

render();
