// All tunable constants for the simulation live here.

export const CONFIG = {
  population: 150,
  districts: 5,

  // --- trust network generation ---
  network: {
    localEdges: 5,        // in-edges from same-district neighbors
    longRangeEdges: 2,    // in-edges rewired anywhere in the city
    hubExtraOutEdges: 6,  // extra out-edges granted to connectors/gossips
    trustMin: 0.25,
    trustMax: 0.95,
  },

  // --- belief propagation (per end-of-day tick) ---
  belief: {
    transmissibility: 0.05, // base per-edge chance/tick that awareness jumps an edge
    socialRate: 0.32,       // how fast belief moves toward the trusted-neighborhood mean
    decayRate: 0.09,        // pull toward the claim's plausibility anchor
    anchorScale: 0.55,      // anchor = plausibility * anchorScale
    contradictionK: 0.45,   // strength of mutual suppression between linked claims
    noise: 0.02,            // per-NPC idiosyncratic wobble, keeps beliefs from flatlining
    awakenPriorWeight: 0.35,// on first hearing: weight of plausibility vs neighborhood signal
    joltScale: 0.65,        // evidence jolt: db = joltScale * quality * (1 - b)
    deadPenetration: 0.02,  // below this penetration with low mean belief, a claim goes dormant
  },

  // --- player economy ---
  player: {
    startCoin: 120,
    actionsPerDay: 3,
    startCredibility: 45,   // per faction, 0..100
    investigateCost: 10,
    forgeTiers: [
      { name: 'Careful',   quality: 0.45, detectability: 0.12, cost: 20 },
      { name: 'Bold',      quality: 0.65, detectability: 0.30, cost: 45 },
      { name: 'Brazen',    quality: 0.88, detectability: 0.55, cost: 80 },
    ],
    leakAudience: 12,       // gossips reached by "leak to the streets"
    layLowCost: 15,         // coin cost of a day spent underground
    layLowRelief: 8,        // exposure shed per lay-low action
    sellAudience: 10,       // faction insiders seeded on a sale
    sellBasePay: 70,
    retireCoin: 450,        // coin needed to unlock retirement
    retireDay: 20,
  },

  // --- faction AI ---
  faction: {
    actionThreshold: 0.55,  // aggregate member belief needed to trigger an action
    actionCooldown: 6,      // days before the same faction reacts to the same claim again
    globalCooldown: 2,      // min days between any two actions by the same faction
    actionDelayMin: 1,      // days between decision and visible action
    actionDelayMax: 4,
    coreMemberAffinity: 0.5,// min affinity to count as an insider for sales/aggregates
    awarenessRamp: 0.35,    // share of core members aware before conviction counts in full
  },

  // --- delayed consequences ---
  consequence: {
    scrutinyDelayMin: 3,      // days after a sale before scrutiny fires
    scrutinyDelayMax: 7,
    scrutinyBaseDebunk: 0.10, // debunk chance floor for a genuine-ish claim
    scrutinyLieFactor: 0.45,  // extra debunk chance scaled by (1 - trueAccuracy)
    debunkBeliefCrash: 0.25,  // beliefs multiply by this on public debunk
    debunkCredibilityHit: 18, // per faction the player sold the claim to
    debunkExposure: 10,
    truthCredibilityGain: 6,  // scrutiny passed on a genuinely accurate claim
    mutationPenetration: 0.30,// population share aware before a claim can mutate
    mutationChance: 0.22,     // per-tick roll once eligible
    mutationMax: 2,           // max mutations spawned per origin claim
    retaliationTraceBase: 0.35,
    retaliationDelayMin: 2,
    retaliationDelayMax: 5,
    playerClaimExposureRate: 14, // exposure/tick per full penetration of a claim about the player
  },

  // --- city meters & pressure valves ---
  meters: {
    unrestStart: 18,
    unrestDecay: 1.4,       // passive cooling per day
    powerStart: { guild: 58, chancery: 52, undertow: 30 },
  },
  valves: {
    unrestInformant: 40,      // Firebrand appears
    notorietyInformant: 30,   // The Antiquarian appears
    coinInformant: 250,       // Mother Low appears
    unrestEnding: 92,         // City in Flames
    dominanceEnding: 88,      // faction consolidation endings
    exposureHunt: 60,         // the Chancery starts hunting the player
    exposureEnding: 100,      // Unmasked
  },

  // --- market ---
  market: {
    startClaims: 7,           // claims on offer at day 1
    ambientClaims: 4,         // seed-pool claims circulating in the city from day 1
    ambientIntervalMin: 4,    // days between city-generated ambient rumors
    ambientIntervalMax: 7,
    refreshChance: 0.75,      // chance/day an unlocked informant brings something new
    maxOnMarket: 8,
    priceSpice: 18,           // price ~ base + spice * this
    priceBase: 12,
  },
};
