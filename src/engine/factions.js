// Faction AI.
//
// Each faction tracks the aggregate belief of its core members per relevant claim.
// When that aggregate crosses the action threshold (and the faction is off cooldown
// for that claim), it schedules a *visible* action a few days out via the event queue.
// Every action names the claim that triggered it, so consequences stay legible.

import { CONFIG } from './config.js';
import { FACTIONS } from './data.js';
import { factionBelief, isClaimActive, clamp01 } from './beliefs.js';
import { scheduleEvent } from './events.js';

export function initFactions() {
  return FACTIONS.map((f) => ({
    id: f.id,
    power: CONFIG.meters.powerStart[f.id],
    // stance toward the other factions: -1 hostile .. +1 allied
    stance: Object.fromEntries(FACTIONS.filter((o) => o.id !== f.id).map((o) => [o.id, defaultStance(f.id, o.id)])),
    cooldowns: {}, // claimId -> day it becomes actionable again
    lastActions: [],
  }));
}

function defaultStance(a, b) {
  const key = [a, b].sort().join('|');
  if (key === 'guild|undertow') return -0.5;
  if (key === 'chancery|undertow') return -0.4;
  if (key === 'chancery|guild') return 0.2;
  return 0;
}

function isRelevant(factionDef, claim) {
  if (claim.about === factionDef.id) return true;          // it's about us
  if (claim.about === 'player') return factionDef.id === 'chancery';
  return factionDef.interests.includes(claim.topic);
}

// Called every tick: check thresholds, schedule actions.
export function factionTick(state) {
  const cfg = CONFIG.faction;
  for (let fi = 0; fi < FACTIONS.length; fi++) {
    const def = FACTIONS[fi];
    const fs = state.factions[fi];
    if ((fs.nextActionDay ?? 0) > state.day) continue;
    for (const claim of state.claims) {
      if (!isClaimActive(claim) || claim.status === 'debunked') continue;
      if (!isRelevant(def, claim)) continue;
      if ((fs.cooldowns[claim.id] ?? 0) > state.day) continue;

      const agg = factionBelief(state, claim, fi);
      claim._factionAgg = claim._factionAgg || {};
      claim._factionAgg[def.id] = agg;
      if (agg < cfg.actionThreshold) continue;

      fs.cooldowns[claim.id] = state.day + cfg.actionCooldown;
      fs.nextActionDay = state.day + cfg.globalCooldown;
      const delay = state.rng.int(cfg.actionDelayMin, cfg.actionDelayMax);
      const action = chooseAction(state, def, claim, agg);
      scheduleEvent(state, state.day + delay, 'faction-action', {
        factionId: def.id, factionIndex: fi, claimId: claim.id, action, agg,
      });
      break; // one decision per faction per day keeps actions legible
    }
  }
}

// Pick a legible action for (faction, claim). Returns an action id.
function chooseAction(state, def, claim, agg) {
  const aboutSelf = claim.about === def.id;
  if (claim.about === 'player' && def.id === 'chancery') return 'hunt-broker';
  if (aboutSelf) {
    // damage control: suppress or spin
    return agg > 0.7 ? 'purge' : 'counter-propaganda';
  }
  switch (def.id) {
    case 'guild':
      if (claim.topic === 'commerce') return state.rng.chance(0.5) ? 'price-shock' : 'embargo';
      if (claim.about === 'undertow') return 'hire-muscle';
      return 'buy-silence';
    case 'chancery':
      if (claim.topic === 'unrest') return 'sweep';
      if (claim.topic === 'occult') return 'quarantine';
      if (claim.about === 'guild') return 'audit';
      return 'surveillance';
    case 'undertow':
      if (claim.about === 'guild' || claim.about === 'chancery') {
        return agg > 0.72 && state.city.unrest > 45 ? 'riot' : 'rally';
      }
      if (claim.topic === 'commerce' || claim.topic === 'unrest') return 'strike';
      return 'pamphlets';
    default:
      return 'rally';
  }
}

// ---------------------------------------------------------------------------
// Action execution (fired from the event queue, 1-4 days after the decision).
// ---------------------------------------------------------------------------
export function executeFactionAction(state, { factionId, factionIndex, claimId, action }) {
  const claim = state.claims.find((c) => c.id === claimId);
  if (!claim) return;
  // If the claim got debunked between decision and execution, the action fizzles.
  if (claim.status === 'debunked') {
    state.log(state.day, 'faction',
      `${FACTIONS[factionIndex].name} quietly shelved their response to "${claim.headline}" after it fell apart.`,
      { faction: factionId, claimId });
    return;
  }

  const fs = state.factions[factionIndex];
  const def = FACTIONS[factionIndex];
  const fx = ACTIONS[action];
  if (!fx) return;
  fx(state, { fs, def, claim, factionIndex });
  fs.lastActions.push({ day: state.day, action, claimId });

  // widely-believed accusations bleed the accused faction's power
  if (claim.about !== 'city' && claim.about !== 'player' && claim.about !== factionId) {
    const target = state.factions.find((x) => x.id === claim.about);
    if (target) {
      target.power = Math.max(0, target.power - 2);
      fs.stance[claim.about] = Math.max(-1, (fs.stance[claim.about] ?? 0) - 0.15);
    }
  }
}

const ACTIONS = {
  'price-shock': (state, { fs, def, claim }) => {
    fs.power = Math.min(100, fs.power + 3);
    state.city.unrest = Math.min(100, state.city.unrest + 6);
    state.log(state.day, 'faction',
      `${def.name}, convinced that "${claim.headline}", jacked up warehouse rates overnight. Bread queues doubled by noon.`,
      { faction: def.id, claimId: claim.id });
  },
  embargo: (state, { fs, def, claim }) => {
    fs.power = Math.min(100, fs.power + 2);
    const other = state.factions.find((x) => x.id === (claim.about === 'guild' ? 'chancery' : claim.about));
    if (other) other.power = Math.max(0, other.power - 3);
    state.city.unrest = Math.min(100, state.city.unrest + 4);
    state.log(state.day, 'faction',
      `${def.name} slapped an embargo on cargo tied to "${claim.headline}". Half the Mole is idle and furious.`,
      { faction: def.id, claimId: claim.id });
  },
  'hire-muscle': (state, { fs, def, claim }) => {
    const undertow = state.factions.find((x) => x.id === 'undertow');
    undertow.power = Math.max(0, undertow.power - 4);
    state.city.unrest = Math.min(100, state.city.unrest + 5);
    fs.stance.undertow = Math.max(-1, fs.stance.undertow - 0.2);
    state.log(state.day, 'faction',
      `${def.name} hired bruisers to "secure the warehouses" over "${claim.headline}". Two Undertow organizers are in the infirmary.`,
      { faction: def.id, claimId: claim.id });
  },
  'buy-silence': (state, { def, claim }) => {
    dampenClaim(state, claim, 0.75);
    state.log(state.day, 'faction',
      `${def.name} spent freely to make "${claim.headline}" a story nobody profits from repeating.`,
      { faction: def.id, claimId: claim.id });
  },
  sweep: (state, { fs, def, claim }) => {
    const undertow = state.factions.find((x) => x.id === 'undertow');
    undertow.power = Math.max(0, undertow.power - 5);
    fs.power = Math.min(100, fs.power + 3);
    state.city.unrest = Math.min(100, state.city.unrest + 8); // arrests breed anger
    state.log(state.day, 'faction',
      `The Chancery swept the Saltrow cellars over "${claim.headline}". Eleven arrests. The docks are seething.`,
      { faction: def.id, claimId: claim.id });
  },
  quarantine: (state, { fs, def, claim }) => {
    state.city.unrest = Math.min(100, state.city.unrest + 5);
    fs.power = Math.min(100, fs.power + 2);
    state.log(state.day, 'faction',
      `The Chancery cordoned the harbor stairs, citing "${claim.headline}". Nobody in, nobody out, no explanations.`,
      { faction: def.id, claimId: claim.id });
  },
  audit: (state, { fs, def, claim }) => {
    const guild = state.factions.find((x) => x.id === 'guild');
    guild.power = Math.max(0, guild.power - 4);
    fs.stance.guild = Math.max(-1, fs.stance.guild - 0.2);
    state.log(state.day, 'faction',
      `Chancery auditors seized Guild ledgers, acting on "${claim.headline}". Candle Hill dinner parties have gone very quiet.`,
      { faction: def.id, claimId: claim.id });
  },
  surveillance: (state, { fs, def, claim }) => {
    fs.power = Math.min(100, fs.power + 2);
    state.log(state.day, 'faction',
      `New watchers on the corners. The Chancery is mapping everyone who repeats "${claim.headline}".`,
      { faction: def.id, claimId: claim.id });
  },
  'hunt-broker': (state, { def, claim }) => {
    state.player.exposure = Math.min(100, state.player.exposure + 15);
    state.log(state.day, 'faction',
      `The Chancery has opened a file on the broker from the stories. The description is getting uncomfortably specific.`,
      { faction: def.id, claimId: claim.id, player: true });
  },
  strike: (state, { fs, def, claim }) => {
    fs.power = Math.min(100, fs.power + 4);
    const guild = state.factions.find((x) => x.id === 'guild');
    guild.power = Math.max(0, guild.power - 3);
    state.city.unrest = Math.min(100, state.city.unrest + 9);
    state.log(state.day, 'faction',
      `The Undertow called a dock strike over "${claim.headline}". Nothing moves on the Mole today.`,
      { faction: def.id, claimId: claim.id });
  },
  rally: (state, { fs, def, claim }) => {
    fs.power = Math.min(100, fs.power + 3);
    state.city.unrest = Math.min(100, state.city.unrest + 6);
    state.log(state.day, 'faction',
      `Torches in Saltrow square: the Undertow rallied hundreds behind "${claim.headline}".`,
      { faction: def.id, claimId: claim.id });
  },
  riot: (state, { fs, def, claim }) => {
    fs.power = Math.min(100, fs.power + 5);
    state.city.unrest = Math.min(100, state.city.unrest + 16);
    const guild = state.factions.find((x) => x.id === 'guild');
    guild.power = Math.max(0, guild.power - 5);
    state.log(state.day, 'faction',
      `Riot. Warehouses burned on the Mole tonight, and "${claim.headline}" was the match.`,
      { faction: def.id, claimId: claim.id });
  },
  pamphlets: (state, { fs, def, claim }) => {
    boostClaim(state, claim, 0.1);
    state.city.unrest = Math.min(100, state.city.unrest + 3);
    state.log(state.day, 'faction',
      `Undertow pamphlets are everywhere, shouting "${claim.headline}" in smudged ink.`,
      { faction: def.id, claimId: claim.id });
  },
  'counter-propaganda': (state, { def, claim }) => {
    dampenClaim(state, claim, 0.8);
    state.log(state.day, 'faction',
      `${def.name} flooded the taverns with a soothing counter-story to "${claim.headline}".`,
      { faction: def.id, claimId: claim.id });
  },
  purge: (state, { fs, def, claim }) => {
    dampenClaim(state, claim, 0.65);
    fs.power = Math.max(0, fs.power - 3); // purges are costly and ugly
    state.city.unrest = Math.min(100, state.city.unrest + 5);
    state.log(state.day, 'faction',
      `${def.name} turned on its own over "${claim.headline}". Someone was made an example of, publicly.`,
      { faction: def.id, claimId: claim.id });
  },
};

function dampenClaim(state, claim, factor) {
  for (let i = 0; i < claim.belief.length; i++) {
    if (claim.aware[i]) claim.belief[i] *= factor;
  }
}

function boostClaim(state, claim, amount) {
  for (let i = 0; i < claim.belief.length; i++) {
    if (claim.aware[i]) claim.belief[i] = clamp01(claim.belief[i] + amount * (1 - claim.belief[i]));
  }
}
