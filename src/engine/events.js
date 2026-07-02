// Event queue + delayed consequence handlers.
//
// Everything that happens "later" goes through here: faction actions, scrutiny,
// debunks, mutations, retaliation against the player. Handlers frequently schedule
// further events — that chaining is what makes consequences ripple across days.

import { CONFIG } from './config.js';
import { FACTIONS, AMBIENT_TEMPLATES } from './data.js';
import { makeClaimState } from './world.js';
import { seedBelief, crashBelief, claimStats, factionCoreMembers, clamp01 } from './beliefs.js';
import { executeFactionAction } from './factions.js';

export function scheduleEvent(state, day, type, payload) {
  const ev = { day, type, payload };
  // keep sorted by day (queue stays small; linear insert is fine)
  const q = state.eventQueue;
  let i = q.length;
  while (i > 0 && q[i - 1].day > day) i--;
  q.splice(i, 0, ev);
  return ev;
}

export function processDueEvents(state) {
  while (state.eventQueue.length && state.eventQueue[0].day <= state.day) {
    const ev = state.eventQueue.shift();
    const handler = HANDLERS[ev.type];
    if (handler) handler(state, ev.payload);
  }
}

const HANDLERS = {
  'faction-action': (state, p) => executeFactionAction(state, p),
  scrutiny: handleScrutiny,
  mutation: handleMutation,
  retaliation: handleRetaliation,
  'ambient-claim': handleAmbientClaim,
  'informant-tip': (state, p) => {
    state.log(state.day, 'market', p.text, {});
  },
};

// ---------------------------------------------------------------------------
// Scrutiny: someone credible takes a hard look at a circulating claim.
// Debunk chance = base + lie factor * (1 - trueAccuracy) + attached forged
// evidence detectability. Truth mostly survives; brazen forgeries mostly don't.
// ---------------------------------------------------------------------------
function handleScrutiny(state, { claimId, source }) {
  const claim = state.claims.find((c) => c.id === claimId);
  if (!claim || claim.status === 'debunked' || claim.status === 'dormant') return;

  const cfg = CONFIG.consequence;
  let p = cfg.scrutinyBaseDebunk + cfg.scrutinyLieFactor * (1 - claim.trueAccuracy);
  let forgedRisk = 0;
  for (const ev of claim.evidence) {
    if (ev.forged) forgedRisk = Math.max(forgedRisk, ev.detectability);
  }
  p = clamp01(p + forgedRisk * 0.8);
  // strong genuine claims resist
  if (claim.trueAccuracy >= 0.6 && forgedRisk === 0) p *= 0.4;

  const who = source || 'A Chancery examiner';
  if (state.rng.chance(p)) {
    debunkClaim(state, claim, who, forgedRisk > 0);
  } else {
    state.log(state.day, 'scrutiny',
      `${who} picked apart "${claim.headline}" — and found nothing they could disprove. The story hardens.`,
      { claimId: claim.id });
    // surviving scrutiny entrenches belief a little
    for (let i = 0; i < claim.belief.length; i++) {
      if (claim.aware[i]) claim.belief[i] = clamp01(claim.belief[i] + 0.06 * claim.belief[i]);
    }
    if (claim.trueAccuracy >= 0.6 && claim.soldTo.length) {
      for (const fid of claim.soldTo) {
        state.player.credibility[fid] = Math.min(100, state.player.credibility[fid] + cfg.truthCredibilityGain);
      }
      state.log(state.day, 'scrutiny',
        `Word gets around that your information held up. Your buyers remember that.`,
        { claimId: claim.id, player: true });
    }
  }
}

export function debunkClaim(state, claim, who, forgeryCaught) {
  const cfg = CONFIG.consequence;
  claim.status = 'debunked';
  claim.debunkedDay = state.day;
  crashBelief(state, claim);

  const forgeNote = forgeryCaught ? ' The evidence behind it was exposed as a forgery.' : '';
  state.log(state.day, 'debunk',
    `${who} publicly demolished "${claim.headline}".${forgeNote}`,
    { claimId: claim.id });

  if (claim.soldTo.length) {
    for (const fid of claim.soldTo) {
      state.player.credibility[fid] = Math.max(0, state.player.credibility[fid] - cfg.debunkCredibilityHit);
      const f = FACTIONS.find((x) => x.id === fid);
      state.log(state.day, 'debunk',
        `The ${f.short} paid you for that claim. They have not forgotten who sold it.`,
        { claimId: claim.id, faction: fid, player: true });
    }
    state.player.exposure = Math.min(100, state.player.exposure + cfg.debunkExposure);

    // an angry buyer may trace it back and retaliate
    const traceP = cfg.retaliationTraceBase + state.player.exposure / 250;
    if (state.rng.chance(traceP)) {
      const fid = state.rng.pick(claim.soldTo);
      scheduleEvent(state, state.day + state.rng.int(cfg.retaliationDelayMin, cfg.retaliationDelayMax),
        'retaliation', { factionId: fid, claimId: claim.id });
    }
  }
}

// ---------------------------------------------------------------------------
// Mutation: a claim that has saturated enough of the city spawns a distorted,
// usually nastier variant, seeded among gossips. The player's tidy insinuation
// comes back wearing a different face.
// ---------------------------------------------------------------------------
function handleMutation(state, { originId, headline }) {
  const origin = state.claims.find((c) => c.id === originId);
  if (origin) origin._pendingMutation = false;
  if (!origin || origin.status === 'debunked') return;

  const rng = state.rng;
  const id = `${originId}-m${origin.mutationsSpawned + 1}`;
  const mutated = makeClaimState(
    {
      id,
      topic: origin.topic,
      about: origin.about,
      headline,
      // distortion drifts away from the truth and gets spicier
      trueAccuracy: clamp01(origin.trueAccuracy * rng.range(0.3, 0.7)),
      plausibility: clamp01(origin.plausibility * rng.range(0.8, 1.1)),
      spice: Math.min(2, origin.spice * rng.range(1.1, 1.35)),
      contradicts: [],
      mutations: [],
      informant: null,
    },
    state.npcs.length,
    state.day,
    { status: 'circulating', originId }
  );
  origin.mutationsSpawned++;
  state.claims.push(mutated);

  const gossips = state.npcs.filter((x) => x.archetype === 'gossip' || x.archetype === 'zealot');
  const seedIds = rng.sample(gossips, 8).map((x) => x.id);
  seedBelief(mutated, seedIds, 0.7, `mutation of ${originId}`);

  state.log(state.day, 'mutation',
    `The story has warped in the telling. Now they say: "${headline}"`,
    { claimId: id, originId });
}

// Called from the tick loop: roll mutation for saturated claims.
export function maybeScheduleMutations(state) {
  const cfg = CONFIG.consequence;
  for (const claim of state.claims) {
    if (claim.status !== 'circulating' && claim.status !== 'sold') continue;
    if (claim._pendingMutation) continue;
    if (!claim.mutations || claim.mutationsSpawned >= Math.min(cfg.mutationMax, claim.mutations.length)) continue;
    const stats = claimStats(claim);
    if (stats.penetration < cfg.mutationPenetration || stats.meanBelief < 0.4) continue;
    if (!state.rng.chance(cfg.mutationChance)) continue;
    const headline = claim.mutations[claim.mutationsSpawned];
    scheduleEvent(state, state.day + state.rng.int(1, 2), 'mutation', { originId: claim.id, headline });
    claim._pendingMutation = true; // reserve so we don't double-schedule
  }
}

// ---------------------------------------------------------------------------
// Retaliation: a faction the player burned strikes back directly.
// ---------------------------------------------------------------------------
function handleRetaliation(state, { factionId, claimId }) {
  const f = FACTIONS.find((x) => x.id === factionId);
  const rng = state.rng;
  const roll = rng.int(0, 2);

  if (roll === 0) {
    const loss = Math.min(state.player.coin, rng.int(30, 70));
    state.player.coin -= loss;
    state.log(state.day, 'retaliation',
      `${f.name} sent collectors. Your strongbox is ${loss} coin lighter, and the message was not subtle.`,
      { faction: factionId, claimId, player: true });
  } else if (roll === 1) {
    state.player.exposure = Math.min(100, state.player.exposure + 12);
    state.log(state.day, 'retaliation',
      `${f.name} has been asking pointed questions about a certain broker. Your name is closer to the surface.`,
      { faction: factionId, claimId, player: true });
  } else {
    // they inject a counter-claim about the player into the belief engine
    const id = `pc-${state.day}-${rng.int(0, 999)}`;
    const counter = makeClaimState(
      {
        id,
        topic: 'scandal',
        about: 'player',
        headline: 'A broker in the Shambles sells invented secrets to anyone with coin',
        trueAccuracy: 0.9, // it is, after all, true
        plausibility: 0.35,
        spice: 1.5,
        contradicts: [],
        mutations: ['The broker who sells lies has a face, and someone has drawn it'],
        informant: null,
      },
      state.npcs.length,
      state.day,
      { status: 'circulating', originId: null }
    );
    state.claims.push(counter);
    const core = factionCoreMembers(state, FACTIONS.findIndex((x) => x.id === factionId));
    seedBelief(counter, core.slice(0, 10).map((x) => x.id), 0.75, `retaliation by ${factionId}`);
    state.log(state.day, 'retaliation',
      `${f.name} is spreading a story of their own — about you. "${counter.headline}"`,
      { faction: factionId, claimId: id, player: true });
  }
}

// ---------------------------------------------------------------------------
// Ambient claims: the city generates its own rumors on a rolling schedule so
// the world never feels like it only reacts to the player.
// ---------------------------------------------------------------------------
function handleAmbientClaim(state) {
  const rng = state.rng;
  const tpl = rng.pick(AMBIENT_TEMPLATES);
  const claim = makeClaimState(
    { ...tpl, id: `amb-${state.day}-${rng.int(0, 999)}`, contradicts: [], informant: null },
    state.npcs.length, state.day, { status: 'circulating' }
  );
  state.claims.push(claim);
  const seeds = rng.sample(state.npcs, 6).map((x) => x.id);
  seedBelief(claim, seeds, 0.55, 'ambient');
  state.log(state.day, 'rumor', `A rumor is moving through the taverns: "${claim.headline}"`, { claimId: claim.id });
  scheduleNextAmbient(state);
}

export function scheduleNextAmbient(state) {
  const m = CONFIG.market;
  scheduleEvent(state, state.day + state.rng.int(m.ambientIntervalMin, m.ambientIntervalMax), 'ambient-claim', {});
}
