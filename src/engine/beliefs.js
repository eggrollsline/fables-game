// Belief propagation engine.
//
// Per active claim, per end-of-day tick, each aware NPC updates via:
//   1. social pull toward the trust-weighted mean of aware neighbors
//   2. decay toward the claim's plausibility anchor (damped by conviction)
//   3. mutual suppression against contradicting claims
//   4. small idiosyncratic noise
// Unaware NPCs may become aware via their in-edges (awareness gating).
//
// For inspectability, the engine records the last tick's per-NPC deltas
// (social/decay/contradiction/noise) per claim, so the UI can answer
// "why does this NPC believe this?" with real numbers, not vibes.

import { CONFIG } from './config.js';

export function isClaimActive(claim) {
  return claim.status !== 'dormant' && claim.status !== 'market';
}

// One full propagation tick over all active claims.
export function propagateBeliefs(state) {
  const { npcs, network, rng } = state;
  const cfg = CONFIG.belief;
  const n = npcs.length;
  const active = state.claims.filter(isClaimActive);

  for (const claim of active) {
    const b = claim.belief;
    const aware = claim.aware;
    const next = new Float64Array(b); // read old values, write new
    const newlyAware = [];

    // delta decomposition for the insight view
    const dSocial = new Float32Array(n);
    const dDecay = new Float32Array(n);
    const dNoise = new Float32Array(n);

    const debunkFactor = claim.status === 'debunked' ? 0.35 : 1;
    const baseAnchor = claim.status === 'debunked'
      ? claim.plausibility * cfg.anchorScale * 0.3
      : claim.plausibility * cfg.anchorScale;

    for (let i = 0; i < n; i++) {
      const npc = npcs[i];
      const edges = network.edgesIn[i];
      // Personal anchor: credulous minds settle higher than skeptical ones.
      // Heterogeneous fixed points keep the population from collapsing to
      // one uniform belief value.
      const anchor = baseAnchor * (0.5 + npc.gullibility);

      if (!aware[i]) {
        // --- awareness gating ---
        let pNotHear = 1;
        let signal = 0;
        let signalW = 0;
        for (const e of edges) {
          if (!aware[e.from]) continue;
          const push = cfg.transmissibility * e.trust * claim.spice * b[e.from]
            * npcs[e.from].influence * debunkFactor;
          pNotHear *= 1 - Math.min(0.9, push);
          signal += e.trust * b[e.from];
          signalW += e.trust;
        }
        if (pNotHear < 1 && rng.chance(1 - pNotHear)) {
          const neighborhood = signalW > 0 ? signal / signalW : claim.plausibility;
          next[i] = cfg.awakenPriorWeight * claim.plausibility
            + (1 - cfg.awakenPriorWeight) * neighborhood;
          newlyAware.push(i);
        }
        continue;
      }

      // --- social pull ---
      let s = 0;
      let w = 0;
      for (const e of edges) {
        if (!aware[e.from]) continue;
        const ew = e.trust * npcs[e.from].influence;
        s += ew * b[e.from];
        w += ew;
      }
      let v = b[i];
      if (w > 0) {
        const social = npc.gullibility * cfg.socialRate * (s / w - v);
        v += social;
        dSocial[i] = social;
      }

      // --- decay toward anchor, damped by conviction ---
      const conviction = Math.abs(2 * v - 1);
      const decay = cfg.decayRate * npc.skepticism * (1 - conviction * 0.8) * (anchor - v);
      v += decay;
      dDecay[i] = decay;

      // --- noise ---
      const noise = rng.range(-cfg.noise, cfg.noise);
      v += noise;
      dNoise[i] = noise;

      next[i] = clamp01(v);
    }

    for (const i of newlyAware) aware[i] = 1;
    claim.belief = next;
    claim._dSocial = dSocial;
    claim._dDecay = dDecay;
    claim._dNoise = dNoise;
    claim._dContra = new Float32Array(n); // filled by the contradiction pass
  }

  // --- contradiction pass (after all claims updated, on fresh values) ---
  applyContradictions(state, active);

  // --- record history + dormancy check ---
  for (const claim of active) {
    const stats = claimStats(claim);
    claim.history.push({ day: state.day, meanBelief: stats.meanBelief, penetration: stats.penetration });
    if (
      stats.penetration > 0 &&
      stats.penetration < cfg.deadPenetration &&
      claim.status === 'circulating'
    ) {
      claim.status = 'dormant';
    }
  }
}

function applyContradictions(state, active) {
  const k = CONFIG.belief.contradictionK;
  const seen = new Set();
  for (const a of active) {
    for (const bId of a.contradicts || []) {
      const key = a.id < bId ? `${a.id}|${bId}` : `${bId}|${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const other = state.claims.find((c) => c.id === bId);
      if (!other || !isClaimActive(other)) continue;
      const n = a.belief.length;
      for (let i = 0; i < n; i++) {
        if (!a.aware[i] || !other.aware[i]) continue;
        const ba = a.belief[i];
        const bb = other.belief[i];
        if (ba > bb) {
          const d = k * ba * (ba - bb) * 0.5;
          other.belief[i] = clamp01(bb - d);
          if (other._dContra) other._dContra[i] -= d;
        } else if (bb > ba) {
          const d = k * bb * (bb - ba) * 0.5;
          a.belief[i] = clamp01(ba - d);
          if (a._dContra) a._dContra[i] -= d;
        }
      }
    }
  }
}

// Seed a claim into specific NPCs (evidence, sale, leak, rumor drop).
// mode 'jolt': partial push (hearsay). mode 'install': sets a belief floor —
// used when someone is directly handed the story with evidence (a sale).
export function seedBelief(claim, npcIds, quality, source, mode = 'jolt') {
  for (const i of npcIds) {
    claim.aware[i] = 1;
    if (mode === 'install') {
      claim.belief[i] = Math.max(claim.belief[i], clamp01(quality));
    } else {
      const jolt = CONFIG.belief.joltScale * quality;
      claim.belief[i] = clamp01(claim.belief[i] + jolt * (1 - claim.belief[i]));
    }
  }
  claim.lastSeed = { day: null, npcIds: [...npcIds], quality, source, mode };
}

// Crash beliefs after a public debunk. Zealots cling; skeptics drop hard.
export function crashBelief(state, claim) {
  const crash = CONFIG.consequence.debunkBeliefCrash;
  for (let i = 0; i < claim.belief.length; i++) {
    if (!claim.aware[i]) continue;
    const npc = state.npcs[i];
    const cling = npc.archetype === 'zealot' ? 0.55 : 0;
    claim.belief[i] *= crash + cling * claim.belief[i];
  }
}

export function claimStats(claim) {
  const n = claim.belief.length;
  let awareCount = 0;
  let sum = 0;
  let believers = 0;
  for (let i = 0; i < n; i++) {
    if (!claim.aware[i]) continue;
    awareCount++;
    sum += claim.belief[i];
    if (claim.belief[i] >= 0.6) believers++;
  }
  return {
    penetration: awareCount / n,
    awareCount,
    meanBelief: awareCount > 0 ? sum / awareCount : 0,
    believers,
  };
}

// Faction conviction metric: influence-weighted mean belief among *aware* core
// members, ramped down until enough of the faction has actually heard the claim.
// Legible reading: "how convinced is the faction, given how far word has spread."
export function factionBelief(state, claim, factionIndex) {
  const minAff = CONFIG.faction.coreMemberAffinity;
  const rampAt = CONFIG.faction.awarenessRamp;
  let sum = 0;
  let wAware = 0;
  let total = 0;
  let awareCount = 0;
  for (const npc of state.npcs) {
    if (npc.factionAffinity[factionIndex] < minAff) continue;
    total++;
    if (!claim.aware[npc.id]) continue;
    awareCount++;
    const ew = npc.influence;
    wAware += ew;
    sum += ew * claim.belief[npc.id];
  }
  if (total === 0 || wAware === 0) return 0;
  const meanAmongAware = sum / wAware;
  const awareShare = awareCount / total;
  return meanAmongAware * Math.min(1, awareShare / rampAt);
}

// Core members of a faction, most-influential first (sale/leak audiences).
export function factionCoreMembers(state, factionIndex) {
  return state.npcs
    .filter((npc) => npc.factionAffinity[factionIndex] >= CONFIG.faction.coreMemberAffinity)
    .sort((a, b) => b.influence - a.influence);
}

export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
