// Population + trust network generation, and claim-state construction.

import { CONFIG } from './config.js';
import { FACTIONS, FIRST_NAMES, LAST_NAMES, DISTRICTS, ARCHETYPES, SEED_CLAIMS, TOPIC_META } from './data.js';

export function generatePopulation(rng) {
  const n = CONFIG.population;
  const npcs = [];
  const archetypeList = [];
  for (const [name, def] of Object.entries(ARCHETYPES)) {
    const count = Math.round(def.share * n);
    for (let i = 0; i < count; i++) archetypeList.push(name);
  }
  while (archetypeList.length < n) archetypeList.push('conformist');
  const shuffledArch = rng.shuffle(archetypeList).slice(0, n);

  const usedNames = new Set();
  for (let i = 0; i < n; i++) {
    const arch = shuffledArch[i];
    const def = ARCHETYPES[arch];
    let name;
    do {
      name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    // Faction affinity: districts lean differently, then per-NPC noise.
    const district = i % CONFIG.districts; // even spread, deterministic
    const lean = districtLean(district);
    const raw = FACTIONS.map((f, fi) => Math.max(0.02, lean[fi] + rng.range(-0.18, 0.18)));
    const sum = raw.reduce((a, b) => a + b, 0);

    npcs.push({
      id: i,
      name,
      district,
      archetype: arch,
      gullibility: rng.range(def.gullibility[0], def.gullibility[1]),
      skepticism: rng.range(def.skepticism[0], def.skepticism[1]),
      influence: rng.range(def.influence[0], def.influence[1]),
      factionAffinity: raw.map((v) => v / sum),
    });
  }
  return npcs;
}

function districtLean(d) {
  // [guild, chancery, undertow] base weights per district
  switch (d) {
    case 0: return [0.15, 0.15, 0.70]; // Saltrow: dockworker slums
    case 1: return [0.25, 0.30, 0.45]; // The Shambles: markets, mixed
    case 2: return [0.60, 0.30, 0.10]; // Candle Hill: money
    case 3: return [0.45, 0.20, 0.35]; // The Mole: docks proper
    case 4: return [0.20, 0.55, 0.25]; // Wren Street: administration
    default: return [0.33, 0.33, 0.34];
  }
}

// Directed trust network: edgesIn[i] = [{from, trust}].
// District-clustered small-world: local ring edges + long-range rewires + hub out-edges.
export function generateNetwork(rng, npcs) {
  const n = npcs.length;
  const cfg = CONFIG.network;
  const byDistrict = Array.from({ length: CONFIG.districts }, () => []);
  for (const npc of npcs) byDistrict[npc.district].push(npc.id);

  const edgesIn = Array.from({ length: n }, () => []);
  const hasEdge = Array.from({ length: n }, () => new Set());

  const addEdge = (from, to, trust) => {
    if (from === to || hasEdge[to].has(from)) return false;
    hasEdge[to].add(from);
    edgesIn[to].push({ from, trust });
    return true;
  };

  for (const npc of npcs) {
    const local = byDistrict[npc.district];
    const idx = local.indexOf(npc.id);
    // ring neighbors within the district
    let added = 0;
    for (let k = 1; added < cfg.localEdges && k <= local.length; k++) {
      const nb = local[(idx + (k % 2 === 0 ? k / 2 : -(k + 1) / 2) + local.length * 3) % local.length];
      if (addEdge(nb, npc.id, rng.range(cfg.trustMin, cfg.trustMax))) added++;
    }
    // long-range edges anywhere in the city
    for (let k = 0; k < cfg.longRangeEdges; k++) {
      for (let tries = 0; tries < 10; tries++) {
        const from = rng.int(0, n - 1);
        if (addEdge(from, npc.id, rng.range(cfg.trustMin, cfg.trustMax * 0.8))) break;
      }
    }
  }

  // hubs (connectors/gossips) get extra out-edges: people listen to them
  for (const npc of npcs) {
    if (npc.archetype !== 'connector' && npc.archetype !== 'gossip') continue;
    for (let k = 0; k < cfg.hubExtraOutEdges; k++) {
      for (let tries = 0; tries < 10; tries++) {
        const to = rng.int(0, n - 1);
        if (addEdge(npc.id, to, rng.range(cfg.trustMin, cfg.trustMax))) break;
      }
    }
  }

  // Also build edgesOut for the UI/network view.
  const edgesOut = Array.from({ length: n }, () => []);
  for (let to = 0; to < n; to++) {
    for (const e of edgesIn[to]) edgesOut[e.from].push({ to, trust: e.trust });
  }
  return { edgesIn, edgesOut };
}

// Build the runtime claim-state object from a claim template.
export function makeClaimState(template, popSize, day, extra = {}) {
  return {
    ...template,
    spice: template.spice ?? TOPIC_META[template.topic].spiceBase,
    status: 'market',       // market | owned | sold | circulating | debunked | dormant
    createdDay: day,
    soldTo: [],             // faction ids the player sold this to
    evidence: [],           // Evidence attached by the player
    investigated: false,
    debunkedDay: null,
    mutationsSpawned: 0,
    originId: null,
    price: Math.round(CONFIG.market.priceBase + (template.spice ?? 1) * CONFIG.market.priceSpice),
    belief: new Float64Array(popSize),
    aware: new Uint8Array(popSize),
    // per-day history for sparklines/insight: {day, meanBelief, penetration}
    history: [],
    ...extra,
  };
}
