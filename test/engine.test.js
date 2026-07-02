// Headless sanity tests for the simulation engine.
// Run with: node --test test/
//
// These encode the validation targets from ARCHITECTURE.md: seeded claims spread,
// unfed claims decay, beliefs neither collapse to uniformity nor saturate to noise,
// contradictions anti-correlate, runs are deterministic per seed, and the full
// buy -> sell -> ripple -> faction action -> scrutiny loop works end to end.

import test from 'node:test';
import assert from 'node:assert/strict';

import { newGame, buyClaim, investigateClaim, forgeEvidence, sellClaim, leakClaim, endDay } from '../src/engine/game.js';
import { propagateBeliefs, seedBelief, claimStats } from '../src/engine/beliefs.js';
import { makeClaimState } from '../src/engine/world.js';
import { CONFIG } from '../src/engine/config.js';

function freshClaim(state, overrides = {}) {
  const claim = makeClaimState(
    {
      id: overrides.id ?? 'test-claim',
      topic: 'scandal',
      about: 'guild',
      headline: 'Test headline',
      trueAccuracy: 0.5,
      plausibility: 0.4,
      spice: 1.4,
      contradicts: [],
      mutations: [],
      informant: null,
      ...overrides,
    },
    state.npcs.length,
    state.day,
    { status: 'circulating' }
  );
  state.claims.push(claim);
  return claim;
}

test('population and network generation are sane', () => {
  const s = newGame('gen-test');
  assert.equal(s.npcs.length, CONFIG.population);
  const degrees = s.network.edgesIn.map((e) => e.length);
  const avg = degrees.reduce((a, b) => a + b, 0) / degrees.length;
  assert.ok(avg >= 5 && avg <= 14, `average in-degree ${avg} out of expected range`);
  assert.ok(degrees.every((d) => d >= 2), 'every NPC has at least 2 in-edges');
  // no self-edges, no duplicate edges
  for (let i = 0; i < s.npcs.length; i++) {
    const froms = s.network.edgesIn[i].map((e) => e.from);
    assert.ok(!froms.includes(i), 'no self-trust edges');
    assert.equal(new Set(froms).size, froms.length, 'no duplicate edges');
  }
});

test('seeded claims spread through the network', () => {
  const s = newGame('spread-test');
  const claim = freshClaim(s);
  const seeds = s.rng.sample(s.npcs, 8).map((x) => x.id);
  seedBelief(claim, seeds, 0.8, 'test');
  const p0 = claimStats(claim).penetration;
  for (let i = 0; i < 10; i++) propagateBeliefs(s);
  const p10 = claimStats(claim).penetration;
  assert.ok(p10 > p0 * 2, `penetration should grow: ${p0} -> ${p10}`);
  assert.ok(p10 < 1, 'a moderate claim should not saturate the whole city in 10 days');
});

test('unfed claims decay toward their plausibility anchor', () => {
  const s = newGame('decay-test');
  const claim = freshClaim(s, { plausibility: 0.3, spice: 0.8 });
  seedBelief(claim, s.rng.sample(s.npcs, 20).map((x) => x.id), 0.95, 'test');
  const m0 = claimStats(claim).meanBelief;
  for (let i = 0; i < 25; i++) propagateBeliefs(s);
  const m25 = claimStats(claim).meanBelief;
  assert.ok(m0 > 0.55, `seed jolt should push mean high, got ${m0}`);
  assert.ok(m25 < m0 - 0.1, `unfed belief should decay: ${m0} -> ${m25}`);
});

test('beliefs neither collapse to uniformity nor saturate to noise', () => {
  const s = newGame('collapse-test');
  const claim = freshClaim(s);
  seedBelief(claim, s.rng.sample(s.npcs, 10).map((x) => x.id), 0.85, 'test');
  for (let i = 0; i < 30; i++) propagateBeliefs(s);
  const vals = [];
  for (let i = 0; i < s.npcs.length; i++) if (claim.aware[i]) vals.push(claim.belief[i]);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  assert.ok(Math.sqrt(variance) > 0.02, `belief should stay heterogeneous, stddev=${Math.sqrt(variance)}`);
  assert.ok(mean > 0.05 && mean < 0.95, `mean belief should not saturate, mean=${mean}`);
  const extreme = vals.filter((v) => v < 0.001 || v > 0.999).length / vals.length;
  assert.ok(extreme < 0.5, 'most beliefs should not be pinned at 0 or 1');
});

test('contradicting claims suppress each other', () => {
  const s = newGame('contra-test');
  const a = freshClaim(s, { id: 'ta', contradicts: ['tb'] });
  const b = freshClaim(s, { id: 'tb', contradicts: ['ta'] });
  // seed A hard everywhere, B weakly everywhere
  const everyone = s.npcs.map((x) => x.id);
  seedBelief(a, everyone, 0.9, 'test');
  seedBelief(b, everyone, 0.35, 'test');
  const b0 = claimStats(b).meanBelief;

  // control run: same B seeding in a parallel world with no contradiction link
  const s2 = newGame('contra-test');
  const b2 = freshClaim(s2, { id: 'tb', contradicts: [] });
  seedBelief(b2, s2.npcs.map((x) => x.id), 0.35, 'test');

  for (let i = 0; i < 12; i++) {
    propagateBeliefs(s);
    propagateBeliefs(s2);
  }
  const withContra = claimStats(b).meanBelief;
  const withoutContra = claimStats(b2).meanBelief;
  assert.ok(withContra < withoutContra - 0.05,
    `contradicted claim should be suppressed: with=${withContra} without=${withoutContra} (started ${b0})`);
  assert.ok(claimStats(a).meanBelief > withContra, 'the stronger claim should stay dominant');
});

test('runs are deterministic per seed', () => {
  const play = () => {
    const s = newGame('determinism');
    const market = s.claims.find((c) => c.status === 'market');
    buyClaim(s, market.id);
    sellClaim(s, market.id, 'undertow');
    for (let i = 0; i < 15; i++) endDay(s);
    return {
      chronicle: s.chronicle.map((e) => `${e.day}|${e.text}`).join('\n'),
      coin: s.player.coin,
      unrest: s.city.unrest,
      beliefSum: s.claims.reduce((a, c) => a + c.belief.reduce((x, y) => x + y, 0), 0),
    };
  };
  const r1 = play();
  const r2 = play();
  assert.deepEqual(r1, r2);
});

test('end-to-end: sell -> ripple -> faction action -> scrutiny', () => {
  const s = newGame('e2e-loop');
  const market = s.claims.filter((c) => c.status === 'market');
  assert.ok(market.length >= 3, 'market should open with stock');

  // Buy and sell the spiciest claim to a faction that cares about it.
  const claim = market.sort((x, y) => y.spice - x.spice)[0];
  assert.equal(buyClaim(s, claim.id).ok, true);
  assert.equal(sellClaim(s, claim.id, 'undertow').ok, true);
  assert.ok(s.player.coin > 0);
  assert.equal(claim.status, 'sold');

  let sawFactionAction = false;
  let sawScrutinyResolution = false;
  for (let i = 0; i < 20 && !s.ending; i++) {
    endDay(s);
    for (const e of s.chronicle) {
      if (e.kind === 'faction' && e.claimId === claim.id) sawFactionAction = true;
      if ((e.kind === 'scrutiny' || e.kind === 'debunk') && e.claimId === claim.id) sawScrutinyResolution = true;
    }
  }
  assert.ok(sawFactionAction, 'a faction should visibly act on the sold claim');
  assert.ok(sawScrutinyResolution, 'the sold claim should face scrutiny');
  const stats = claimStats(claim);
  assert.ok(stats.penetration > 0.1, `sold claim should have spread, penetration=${stats.penetration}`);
});

test('forgery: brazen fakes get debunked far more often than clean truths', () => {
  const runs = 30;
  let brazenDebunks = 0;
  let truthDebunks = 0;
  for (let r = 0; r < runs; r++) {
    // brazen forgery on a false claim
    const s1 = newGame(`forge-${r}`);
    const lie = freshClaim(s1, { id: 'lie', trueAccuracy: 0.1, status: 'owned' });
    lie.status = 'owned';
    forgeEvidence(s1, 'lie', 2); // Brazen
    sellClaim(s1, 'lie', 'guild');
    for (let i = 0; i < 12 && !s1.ending; i++) endDay(s1);
    if (s1.claims.find((c) => c.id === 'lie').status === 'debunked') brazenDebunks++;

    // clean genuine claim
    const s2 = newGame(`truth-${r}`);
    const truth = freshClaim(s2, { id: 'truth', trueAccuracy: 0.9 });
    truth.status = 'owned';
    sellClaim(s2, 'truth', 'guild');
    for (let i = 0; i < 12 && !s2.ending; i++) endDay(s2);
    if (s2.claims.find((c) => c.id === 'truth').status === 'debunked') truthDebunks++;
  }
  assert.ok(brazenDebunks / runs > 0.5, `brazen forgeries should usually burn: ${brazenDebunks}/${runs}`);
  assert.ok(truthDebunks / runs < 0.25, `clean truths should usually survive: ${truthDebunks}/${runs}`);
  assert.ok(brazenDebunks > truthDebunks * 2, 'forgery risk must dominate');
});

test('debunked sold claims damage credibility and raise exposure', () => {
  // find a seed where a debunk actually lands
  for (let r = 0; r < 40; r++) {
    const s = newGame(`debunk-${r}`);
    const lie = freshClaim(s, { id: 'lie', trueAccuracy: 0.05 });
    lie.status = 'owned';
    forgeEvidence(s, 'lie', 2);
    const credBefore = s.player.credibility.guild;
    sellClaim(s, 'lie', 'guild');
    for (let i = 0; i < 12 && !s.ending; i++) endDay(s);
    if (s.claims.find((c) => c.id === 'lie').status === 'debunked') {
      assert.ok(s.player.credibility.guild < credBefore, 'credibility with the buyer must drop');
      assert.ok(s.player.exposure > 0, 'exposure must rise');
      return;
    }
  }
  assert.fail('no debunk landed in 40 seeded runs — scrutiny odds are broken');
});

test('investigation reveals accuracy and true claims yield genuine evidence', () => {
  const s = newGame('invest-test');
  const claim = freshClaim(s, { id: 'inv', trueAccuracy: 0.8, status: 'market', price: 10 });
  claim.status = 'market';
  buyClaim(s, 'inv');
  const res = investigateClaim(s, 'inv');
  assert.equal(res.ok, true);
  assert.equal(claim.investigated, true);
  assert.ok(claim.evidence.some((e) => !e.forged), 'true claim should yield genuine evidence');
});

test('leaking spreads a claim without payment', () => {
  const s = newGame('leak-test');
  const claim = freshClaim(s, { id: 'lk', status: 'market', price: 10 });
  claim.status = 'market';
  buyClaim(s, 'lk');
  const coinBefore = s.player.coin;
  leakClaim(s, 'lk');
  assert.equal(s.player.coin, coinBefore, 'leaking pays nothing');
  assert.ok(claimStats(claim).awareCount >= CONFIG.player.leakAudience * 0.8);
  for (let i = 0; i < 6; i++) endDay(s);
  assert.ok(claimStats(claim).penetration > 0.15, 'leaked claim should spread');
});

test('mutations spawn from saturated claims and are traceable to their origin', () => {
  for (let r = 0; r < 25; r++) {
    const s = newGame(`mut-${r}`);
    const claim = freshClaim(s, {
      id: 'orig', trueAccuracy: 0.6, spice: 1.8, plausibility: 0.6,
      mutations: ['The mutated version of the story'],
    });
    claim.status = 'owned';
    sellClaim(s, 'orig', 'undertow');
    leakClaim(s, 'orig');
    for (let i = 0; i < 18 && !s.ending; i++) endDay(s);
    const mutated = s.claims.find((c) => c.originId === 'orig');
    if (mutated) {
      assert.equal(mutated.headline, 'The mutated version of the story');
      assert.ok(mutated.spice > claim.spice, 'mutations get spicier');
      assert.ok(claimStats(mutated).awareCount > 0, 'mutation should be seeded');
      return;
    }
  }
  assert.fail('no mutation spawned across 25 seeds — mutation odds are broken');
});

test('long unattended runs stay numerically sane', () => {
  const s = newGame('longrun');
  for (let i = 0; i < 60 && !s.ending; i++) endDay(s);
  for (const claim of s.claims) {
    for (let i = 0; i < claim.belief.length; i++) {
      const b = claim.belief[i];
      assert.ok(Number.isFinite(b) && b >= 0 && b <= 1, `belief out of range: ${b}`);
    }
  }
  assert.ok(s.city.unrest >= 0 && s.city.unrest <= 100);
  assert.ok(s.player.exposure >= 0 && s.player.exposure <= 100);
});
