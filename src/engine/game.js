// Game orchestrator: state creation, player actions, the end-of-day tick,
// city meters, pressure valves, and endings.

import { CONFIG } from './config.js';
import { FACTIONS, INFORMANTS, SEED_CLAIMS, ENDINGS } from './data.js';
import { makeRng, hashSeed } from './rng.js';
import { generatePopulation, generateNetwork, makeClaimState } from './world.js';
import { propagateBeliefs, seedBelief, claimStats, factionBelief, factionCoreMembers, isClaimActive } from './beliefs.js';
import { initFactions, factionTick } from './factions.js';
import { scheduleEvent, processDueEvents, maybeScheduleMutations, scheduleNextAmbient } from './events.js';

export function newGame(seed = 'undertow') {
  const rng = makeRng(typeof seed === 'number' ? seed : hashSeed(seed));
  const npcs = generatePopulation(rng);
  const network = generateNetwork(rng, npcs);

  const state = {
    seed,
    rng,
    day: 1,
    npcs,
    network,
    claims: [],
    claimPool: rng.shuffle(SEED_CLAIMS.map((c) => ({ ...c }))), // undrawn templates
    eventQueue: [],
    factions: initFactions(),
    city: {
      unrest: CONFIG.meters.unrestStart,
      notoriety: 0,
    },
    player: {
      coin: CONFIG.player.startCoin,
      actionsLeft: CONFIG.player.actionsPerDay,
      exposure: 0,
      credibility: Object.fromEntries(FACTIONS.map((f) => [f.id, CONFIG.player.startCredibility])),
      unlockedInformants: new Set(['ferret', 'widow']),
    },
    valvesFired: new Set(),
    ending: null,
    chronicle: [],
    log(day, kind, text, meta = {}) {
      state.chronicle.push({ day, kind, text, ...meta });
    },
  };

  // Ambient claims: the city starts with rumors of its own.
  for (let i = 0; i < CONFIG.market.ambientClaims; i++) {
    const tpl = drawFromPool(state, null);
    if (!tpl) break;
    const claim = makeClaimState(tpl, npcs.length, 0, { status: 'circulating' });
    state.claims.push(claim);
    seedBelief(claim, rng.sample(npcs, 6).map((x) => x.id), 0.5, 'ambient');
  }

  // Initial market stock.
  for (let i = 0; i < CONFIG.market.startClaims; i++) {
    const tpl = drawFromPool(state, state.player.unlockedInformants);
    if (!tpl) break;
    state.claims.push(makeClaimState(tpl, npcs.length, 0));
  }

  // Let the ambient rumors breathe for a few days before day 1.
  for (let i = 0; i < 3; i++) propagateBeliefs(state);

  // The city keeps generating its own rumors on a rolling schedule.
  scheduleNextAmbient(state);

  state.log(1, 'system',
    'Brack Harbor, before dawn. You have a strongbox, two informants, and a city that believes whatever it hears twice.',
    {});
  return state;
}

function drawFromPool(state, unlockedInformants) {
  const idx = state.claimPool.findIndex((t) =>
    unlockedInformants == null
      ? true
      : t.informant == null || unlockedInformants.has(t.informant)
  );
  if (idx === -1) return null;
  return state.claimPool.splice(idx, 1)[0];
}

// ---------------------------------------------------------------------------
// Player actions. Each returns {ok, msg}. Each consumes one action.
// ---------------------------------------------------------------------------
function spendAction(state) {
  if (state.ending) return { ok: false, msg: 'The game is over.' };
  if (state.player.actionsLeft <= 0) return { ok: false, msg: 'No actions left today. End the day.' };
  state.player.actionsLeft--;
  return null;
}

export function buyClaim(state, claimId) {
  const claim = state.claims.find((c) => c.id === claimId);
  if (!claim || claim.status !== 'market') return { ok: false, msg: 'Not on the market.' };
  if (state.player.coin < claim.price) return { ok: false, msg: 'Not enough coin.' };
  const err = spendAction(state);
  if (err) return err;
  state.player.coin -= claim.price;
  claim.status = 'owned';
  state.log(state.day, 'player', `Bought "${claim.headline}" for ${claim.price} coin.`, { claimId, player: true });
  return { ok: true, msg: `Yours now: "${claim.headline}"` };
}

export function investigateClaim(state, claimId) {
  const claim = state.claims.find((c) => c.id === claimId);
  if (!claim || claim.status !== 'owned') return { ok: false, msg: 'You can only investigate claims you own.' };
  if (claim.investigated) return { ok: false, msg: 'Already investigated.' };
  if (state.player.coin < CONFIG.player.investigateCost) return { ok: false, msg: 'Not enough coin.' };
  const err = spendAction(state);
  if (err) return err;
  state.player.coin -= CONFIG.player.investigateCost;
  claim.investigated = true;
  const acc = claim.trueAccuracy;
  let verdict;
  if (acc >= 0.7) verdict = 'It checks out. This is substantially true.';
  else if (acc >= 0.45) verdict = 'A tangle: real threads, embellished weave.';
  else if (acc >= 0.2) verdict = 'Mostly invention, with a grain of something.';
  else verdict = 'Fabricated, root and branch.';
  // genuine corroboration for true claims: potent, nearly undetectable
  if (acc >= 0.6) {
    claim.evidence.push({ claimId, quality: 0.5, detectability: 0.04, forged: false, name: 'Corroborating documents' });
    verdict += ' You even secured corroborating documents.';
  }
  state.log(state.day, 'player', `Investigated "${claim.headline}". ${verdict}`, { claimId, player: true });
  return { ok: true, msg: verdict };
}

export function forgeEvidence(state, claimId, tierIndex) {
  const claim = state.claims.find((c) => c.id === claimId);
  if (!claim || claim.status !== 'owned') return { ok: false, msg: 'You can only forge for claims you own.' };
  const tier = CONFIG.player.forgeTiers[tierIndex];
  if (!tier) return { ok: false, msg: 'No such forgery tier.' };
  if (state.player.coin < tier.cost) return { ok: false, msg: 'Not enough coin.' };
  if (claim.evidence.some((e) => e.forged)) return { ok: false, msg: 'This claim already carries a forgery. Stacking fakes multiplies risk for nothing.' };
  const err = spendAction(state);
  if (err) return err;
  state.player.coin -= tier.cost;
  claim.evidence.push({
    claimId, quality: tier.quality, detectability: tier.detectability, forged: true,
    name: `${tier.name} forgery`,
  });
  state.log(state.day, 'player',
    `Commissioned a ${tier.name.toLowerCase()} forgery for "${claim.headline}".`,
    { claimId, player: true });
  return { ok: true, msg: `The ${tier.name.toLowerCase()} forgery is ready. Quality ${tier.quality}, detectability ${tier.detectability}.` };
}

export function sellClaim(state, claimId, factionId) {
  const claim = state.claims.find((c) => c.id === claimId);
  if (!claim || (claim.status !== 'owned' && claim.status !== 'sold')) {
    return { ok: false, msg: 'You can only sell claims you own.' };
  }
  if (claim.soldTo.includes(factionId)) return { ok: false, msg: 'They already bought this one.' };
  const fi = FACTIONS.findIndex((f) => f.id === factionId);
  if (fi === -1) return { ok: false, msg: 'No such faction.' };
  const err = spendAction(state);
  if (err) return err;

  const def = FACTIONS[fi];
  const cred = state.player.credibility[factionId];
  const relevance = def.interests.includes(claim.topic) || claim.about !== 'city' ? 1 : 0.6;
  const evidenceQ = bestEvidenceQuality(claim);
  const pay = Math.round(
    CONFIG.player.sellBasePay * claim.spice * relevance * (0.4 + cred / 100) * (0.8 + evidenceQ * 0.6)
  );
  state.player.coin += pay;
  claim.status = 'sold';
  claim.soldTo.push(factionId);
  state.city.notoriety += 3;

  // The buyers are handed the story directly, evidence and all: their belief
  // starts high (install), then the propagation engine takes it from there.
  const core = factionCoreMembers(state, fi).slice(0, CONFIG.player.sellAudience);
  const seedQuality = 0.65 + evidenceQ * 0.3;
  seedBelief(claim, core.map((x) => x.id), seedQuality, `sold to ${factionId}`, 'install');

  // consequences begin: scrutiny is coming, whether or not anyone knows it yet
  const delay = state.rng.int(CONFIG.consequence.scrutinyDelayMin, CONFIG.consequence.scrutinyDelayMax);
  scheduleEvent(state, state.day + delay, 'scrutiny', {
    claimId, source: state.rng.chance(0.5) ? 'A Chancery examiner' : 'A rival broker',
  });

  state.log(state.day, 'player',
    `Sold "${claim.headline}" to ${def.name} for ${pay} coin.`,
    { claimId, faction: factionId, player: true });
  return { ok: true, msg: `${def.name} paid ${pay} coin. They will act on what they believe.` };
}

export function leakClaim(state, claimId) {
  const claim = state.claims.find((c) => c.id === claimId);
  if (!claim || (claim.status !== 'owned' && claim.status !== 'sold')) {
    return { ok: false, msg: 'You can only leak claims you own.' };
  }
  const err = spendAction(state);
  if (err) return err;
  const gossips = state.npcs.filter((x) => x.archetype === 'gossip' || x.archetype === 'connector');
  const audience = state.rng.sample(gossips, CONFIG.player.leakAudience);
  const evidenceQ = bestEvidenceQuality(claim);
  seedBelief(claim, audience.map((x) => x.id), 0.5 + evidenceQ * 0.4, 'street leak');
  if (claim.status === 'owned') claim.status = 'circulating';
  state.city.notoriety += 2;
  state.player.exposure = Math.min(100, state.player.exposure + 2);
  state.log(state.day, 'player',
    `Leaked "${claim.headline}" into the taverns. No payment — but the city is chewing on it now.`,
    { claimId, player: true });
  return { ok: true, msg: 'The story is loose in the streets.' };
}

export function layLow(state) {
  const cost = CONFIG.player.layLowCost;
  if (state.player.coin < cost) return { ok: false, msg: 'Going underground costs coin: bribes, back rooms, borrowed faces.' };
  const err = spendAction(state);
  if (err) return err;
  state.player.coin -= cost;
  state.player.exposure = Math.max(0, state.player.exposure - CONFIG.player.layLowRelief);
  state.log(state.day, 'player', 'You kept to the back rooms and paid people to misremember your face.', { player: true });
  return { ok: true, msg: 'The trail cools a little.' };
}

export function retire(state) {
  if (state.ending) return { ok: false, msg: 'The game is over.' };
  if (!canRetire(state)) return { ok: false, msg: 'Not yet. You need real coin and a reputation before you can vanish cleanly.' };
  endRun(state, 'grayEminence');
  return { ok: true, msg: ENDINGS.grayEminence.text };
}

export function canRetire(state) {
  return state.player.coin >= CONFIG.player.retireCoin && state.day >= CONFIG.player.retireDay;
}

function bestEvidenceQuality(claim) {
  return claim.evidence.reduce((m, e) => Math.max(m, e.quality), 0);
}

// ---------------------------------------------------------------------------
// End-of-day tick.
// ---------------------------------------------------------------------------
export function endDay(state) {
  if (state.ending) return;
  state.day++;
  state.player.actionsLeft = CONFIG.player.actionsPerDay;

  propagateBeliefs(state);
  factionTick(state);
  maybeScheduleMutations(state);
  processDueEvents(state);
  updateMeters(state);
  refreshMarket(state);
  checkValves(state);
  checkEndings(state);
}

function updateMeters(state) {
  const c = state.city;
  c.unrest = Math.max(0, c.unrest - CONFIG.meters.unrestDecay);

  // claims about the player heat up exposure as they spread
  for (const claim of state.claims) {
    if (claim.about !== 'player' || !isClaimActive(claim) || claim.status === 'debunked') continue;
    const stats = claimStats(claim);
    state.player.exposure = Math.min(100,
      state.player.exposure + CONFIG.consequence.playerClaimExposureRate * stats.penetration * stats.meanBelief * 0.1);
  }
}

function refreshMarket(state) {
  const onMarket = state.claims.filter((c) => c.status === 'market').length;
  if (onMarket >= CONFIG.market.maxOnMarket) return;
  if (!state.rng.chance(CONFIG.market.refreshChance)) return;
  const tpl = drawFromPool(state, state.player.unlockedInformants);
  if (!tpl) return;
  const claim = makeClaimState(tpl, state.npcs.length, state.day);
  state.claims.push(claim);
  const informant = INFORMANTS.find((x) => x.id === tpl.informant);
  state.log(state.day, 'market',
    `${informant ? informant.name : 'A contact'} has something for you: "${claim.headline}" (${claim.price} coin).`,
    { claimId: claim.id });
}

// ---------------------------------------------------------------------------
// Pressure valves: one-way latches that unlock informants and endings.
// ---------------------------------------------------------------------------
function checkValves(state) {
  const v = CONFIG.valves;
  const fire = (key, fn) => {
    if (state.valvesFired.has(key)) return;
    state.valvesFired.add(key);
    fn();
  };

  if (state.city.unrest >= v.unrestInformant) {
    fire('firebrand', () => {
      state.player.unlockedInformants.add('firebrand');
      state.log(state.day, 'valve',
        'The city is angry enough that the Firebrand has found you. He deals in the kind of stories that start fires.',
        {});
    });
  }
  if (state.city.notoriety >= v.notorietyInformant) {
    fire('antiquarian', () => {
      state.player.unlockedInformants.add('antiquarian');
      state.log(state.day, 'valve',
        'Your name means something now. The Antiquarian has sent a card: forgeries, provenances, and older things.',
        {});
    });
  }
  if (state.player.coin >= v.coinInformant) {
    fire('motherlow', () => {
      state.player.unlockedInformants.add('motherlow');
      state.log(state.day, 'valve',
        'Mother Low will see you now. Her ledgers reach places the Chancery cannot subpoena.',
        {});
    });
  }
  if (state.player.exposure >= v.exposureHunt) {
    fire('hunt', () => {
      state.log(state.day, 'valve',
        'There are watchers outside the coffee house you favor. The hunt for the broker has begun in earnest.',
        { player: true });
    });
  }
}

function checkEndings(state) {
  if (state.ending) return;
  const v = CONFIG.valves;
  if (state.player.exposure >= v.exposureEnding) return endRun(state, 'unmasked');
  if (state.city.unrest >= v.unrestEnding) return endRun(state, 'cityInFlames');
  for (const fs of state.factions) {
    if (fs.power >= v.dominanceEnding) {
      const map = { guild: 'companyTown', chancery: 'panopticon', undertow: 'theFlood' };
      return endRun(state, map[fs.id]);
    }
  }
}

function endRun(state, endingId) {
  state.ending = { ...ENDINGS[endingId], day: state.day };
  state.log(state.day, 'ending', `ENDING — ${state.ending.title}: ${state.ending.text}`, {});
}

// ---------------------------------------------------------------------------
// Insight helpers (the "why does this NPC believe this" API for the UI/tests).
// ---------------------------------------------------------------------------
export function inspectNpc(state, npcId) {
  const npc = state.npcs[npcId];
  const trusted = state.network.edgesIn[npcId]
    .map((e) => ({ name: state.npcs[e.from].name, id: e.from, trust: e.trust }))
    .sort((a, b) => b.trust - a.trust);
  const beliefs = state.claims
    .filter((c) => isClaimActive(c) && c.aware[npcId])
    .map((c) => ({
      claimId: c.id,
      headline: c.headline,
      belief: c.belief[npcId],
      lastTick: {
        social: c._dSocial ? c._dSocial[npcId] : 0,
        decay: c._dDecay ? c._dDecay[npcId] : 0,
        contradiction: c._dContra ? c._dContra[npcId] : 0,
        noise: c._dNoise ? c._dNoise[npcId] : 0,
      },
    }))
    .sort((a, b) => b.belief - a.belief);
  return { npc, trusted, beliefs };
}

export function inspectClaim(state, claimId) {
  const claim = state.claims.find((c) => c.id === claimId);
  if (!claim) return null;
  const stats = claimStats(claim);
  const factionAggs = FACTIONS.map((f, fi) => ({
    id: f.id, name: f.short, agg: factionBelief(state, claim, fi),
  }));
  return { claim, stats, factionAggs, history: claim.history };
}

export { claimStats, factionBelief, isClaimActive };
export { CONFIG } from './config.js';
export { FACTIONS, INFORMANTS, ENDINGS } from './data.js';
