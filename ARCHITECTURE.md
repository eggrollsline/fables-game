# Undertow — Architecture Proposal

A single-player belief-market simulation. You are an information broker in **Brack Harbor**,
a fog-bound port city where what people *believe* moves faster than what is *true*.

This document is the design/architecture proposal requested in the brief. Assumptions and
deliberate deviations are flagged inline with **[ASSUMPTION]** markers and summarized at the end.

---

## 1. Tech stack

- **Vanilla JavaScript (ES modules), zero dependencies, no build step.**
  The whole game runs from static files (`index.html` + `src/`). Serve with any static
  server (`python3 -m http.server`) or open directly.
- **Engine/UI split is strict.** Everything under `src/engine/` is pure and DOM-free, so the
  identical simulation code runs headlessly under Node (`node --test`) for the sanity tests
  and automated playthroughs. The UI (`src/ui/`) is a thin renderer over engine state.
- **Deterministic seeded RNG** (mulberry32). Every game has a seed; a whole playthrough is
  reproducible, which makes tuning and bug reports tractable.

**[ASSUMPTION]** "Text/UI-driven is fine" → a single-page browser app with panels and a
canvas-drawn trust network, rather than a terminal game. The browser gives us the
"clean interface for browsing claims, trust networks, and faction states" for free.

---

## 2. Core data structures

### 2.1 NPC (population member)

Stored in flat parallel arrays where hot (`beliefs`), objects where cold (metadata).

```js
{
  id: 17,
  name: "Maren Holt",
  district: 2,               // 0..4, drives network clustering
  archetype: "connector",    // skeptic | conformist | zealot | connector | gossip
  gullibility: 0.55,         // scales social pull (skeptics low, zealots high)
  skepticism: 0.4,           // scales decay-toward-prior
  influence: 1.8,            // out-edge weight multiplier; connectors/gossips high
  factionAffinity: [0.7, 0.1, 0.2],  // soft membership across the 3 factions
}
```

Beliefs are **not** stored on the NPC. Per claim we keep a dense
`Float64Array(popSize)` of confidences plus a `Uint8Array` awareness mask —
cache-friendly for the propagation loop and trivially inspectable
(histograms, per-NPC insight view) without walking objects.

### 2.2 Claim

```js
{
  id: "c07",
  headline: "The Chandlers' Guild is shorting the grain reserve",
  topic: "commerce",          // commerce | security | unrest | scandal | occult
  about: "guild",             // which faction the claim implicates (or "city"/"player")
  trueAccuracy: 0.23,         // hidden ground truth 0..1; revealed by Investigate
  plausibility: 0.5,          // public prior; decay anchor and initial belief seed
  spice: 1.4,                 // virality multiplier (scandal spreads, ledgers don't)
  contradicts: ["c11"],       // mutual suppression links
  mutations: ["…", "…"],      // distorted headlines it can turn into while spreading
  status: "market",           // market | owned | sold | debunked | mutated-out
  originId: null,             // set if this claim was spawned as a mutation
}
```

Confidence per NPC lives in the belief matrix keyed by claim id. Claims a player can buy
sit in the **market**; the world also has ambient claims that circulate on their own so the
city never feels like it only reacts to the player.

### 2.3 Trust edge

Directed, weighted adjacency list: `edgesIn[npcId] = [{ from, trust }]`.
`trust ∈ (0,1]` is "how much I weight this person's beliefs". Built as a
district-clustered small-world graph: k-nearest within district + random long-range
rewires + extra out-edges for connector/gossip archetypes. ~6–10 in-edges per NPC.
Static for the MVP. **[ASSUMPTION]** Dynamic trust (edges strengthening/breaking) is
listed as future work, not MVP.

### 2.4 Evidence

```js
{
  claimId: "c07",
  quality: 0.8,        // how hard it pushes belief (jolt size + spread boost)
  detectability: 0.55, // per-scrutiny chance contribution of being exposed as fake
  forged: true,        // investigate-sourced evidence is genuine, low detectability
  audience: "guild",   // whose members got seeded when it was deployed
}
```

The forge dial trades the two off: `detectability ≈ quality² · craftPenalty`, reduced by
spending more coin/time. Genuine corroborating evidence (from Investigate on a true claim)
has near-zero detectability but capped quality.

### 2.5 Event queue

A day-ordered array of pending events, the backbone of delayed consequences:

```js
{ day: 14, type: "faction-action", payload: { faction: "chancery", action: "sweep", claimId: "c07" } }
{ day: 16, type: "scrutiny",       payload: { claimId: "c07" } }
{ day: 18, type: "retaliation",    payload: { target: "player", faction: "guild", severity: 2 } }
```

Insertion keeps the array sorted by day (sizes are tens, not thousands). Each end-of-day
tick pops everything due, executes, and often *schedules more events* — that chaining is
what makes a claim sold on day 5 resurface mutated on day 12.

### 2.6 Player

```js
{
  coin, actionsPerDay,
  exposure: 0..100,                  // how close the city is to unmasking you
  credibility: { guild, chancery, tide },  // per-faction, gates prices & buys
  portfolio: [claimIds], evidence: [Evidence],
  investigated: Set<claimId>,        // trueAccuracy revealed
  unlockedInformants: [...],
}
```

---

## 3. Belief propagation engine

Runs once per end-of-day tick, per *active* claim (a claim is active while any NPC is aware
of it and it isn't dead). Bayesian-*inspired*, tuned for legibility:

For NPC `i`, claim `c`, current belief `b`:

1. **Awareness gating.** Unaware NPCs hold no belief. Each tick, an unaware NPC becomes
   aware with probability `1 − Π(1 − transmissibility · trustᵢⱼ · spice · bⱼ)` over aware
   in-neighbors `j`; on awakening, belief initializes to a blend of the claim's
   plausibility and the neighborhood signal.
2. **Social pull.** `S = Σ trustᵢⱼ · influenceⱼ · bⱼ / Σ trustᵢⱼ · influenceⱼ` over aware
   neighbors; then `b += gullibilityᵢ · socialRate · (S − b)`.
3. **Evidence jolts** (event-driven, not per-tick): deployed evidence hits a seeded
   audience with `Δb = joltScale · quality · receptivity`, then propagates socially.
4. **Decay.** `b += decayRate · skepticismᵢ · (1 − conviction) · (anchor − b)` where
   `anchor = plausibility · anchorScale` and `conviction = |2b − 1|` — entrenched
   believers/deniers barely drift; fresh rumors fade if unfed.
5. **Contradiction.** For each linked pair (A, B), the stronger belief suppresses the
   weaker: `weaker −= contradictionK · stronger · (stronger − weaker)`. Believing the
   Guild is bankrupt actively erodes belief that the Guild is secretly hoarding gold.
6. Clamp to [0,1].

All constants live in `config.js`. Cost: ~150 NPCs × ~30 claims × ~8 edges ≈ 40k ops/tick —
nothing.

**Validation targets** (encoded as automated tests): no uniform-belief collapse, no
saturation-to-noise, seeded claims actually spread along edges, unfed claims decay,
contradictions produce anti-correlated belief, determinism per seed.

---

## 4. Factions (3 for MVP)

| Faction | Flavor | Cares about | Signature actions |
|---|---|---|---|
| **Chandlers' Guild** | merchant cartel running the docks | commerce, scandal touching trade | price shocks, embargoes, buying silence, hiring the player |
| **The Chancery** | the harbor's secret police | security, unrest, occult | sweeps/arrests, curfews, counter-propaganda, *investigating the player* |
| **The Undertow** | populist dockworker movement (namesake) | unrest, scandal, anything anti-Guild/Chancery | strikes, rallies, riots, sheltering or doxxing the player |

Each faction tracks:
- `power` (0..100) and a **stance matrix** toward the other factions (ally/neutral/hostile),
- an **aggregate belief** per relevant claim = influence-weighted mean over NPCs with
  affinity to it,
- `credibility[player]`.

**Decision rule (legible by design):** every tick, for each claim in a faction's interest
profile, if aggregate belief crosses that action's threshold (with hysteresis + cooldown),
the faction schedules a visible action 1–4 days out via the event queue. Every action log
line names the claim that triggered it, so the player can always trace consequence → cause.
Selling a claim to a faction = seeding a strong belief jolt in that faction's core members
+ immediate payout scaled by (claimed) relevance, spice, and your credibility with them.

---

## 5. Delayed consequences

Everything player-caused routes through the event queue and the propagation engine, so
nothing lands instantly:

- **Sell → ripple → action:** the sale seeds ~10 faction insiders; belief spreads over 2–5
  days; the threshold trip schedules an action 1–4 days later still.
- **Mutation:** when a claim's population penetration crosses a threshold, it can spawn a
  *mutated* variant (distorted headline, shifted accuracy, sometimes a new target) seeded
  among gossips — the player's tidy insinuation comes back as something uglier.
- **Scrutiny & debunking:** high-visibility claims attract scheduled scrutiny events
  (Chancery, rival brokers). Debunk chance stacks with forged-evidence detectability.
  A debunk crashes belief, refunds nothing, hits credibility with every faction the player
  sold it to, and raises **exposure**.
- **Retaliation:** factions that trace a debunked or damaging claim to the player schedule
  direct backlash — coin seizure, informant loss, an assassination-adjacent "accident,"
  or a public accusation *claim about the player* injected into the very same belief engine.

---

## 6. Pressure valves & emergent narrative

No scripted beats. City-scale meters — **unrest**, per-faction **dominance**, player
**exposure**, player **notoriety** — are recomputed each tick from faction power and
belief state. Threshold crossings (one-way latches) unlock content or end the run:

- unrest tiers → riot-grade claim types + the *Firebrand* informant; at the top, the
  **City in Flames** ending.
- faction dominance → that faction consolidates (endings: *Company Town*, *Panopticon*,
  *The Flood*), each colored by whether the player helped them (patron) or not (casualty).
- exposure tiers → a hunt: watchers appear in the log, prices worsen, then the **Unmasked**
  ending.
- survival + wealth → the *retire* option (**Gray Eminence** ending), the "win."

The **Chronicle** (event log) is the narrative artifact: every entry is tagged with cause
(claim, faction, player action) and the end screen replays the run as a causal story.

---

## 7. Insight / debug view

- **Network view:** canvas graph of the trust network, nodes colored by belief in the
  selected claim, replayable day by day.
- **NPC inspector:** click a node → its archetype, faction affinity, trusted sources, and
  per-claim belief *with the last tick's decomposition* (social pull ±x from whom,
  evidence jolt, decay, contradiction) — the "why do you believe this" panel.
- **Claim inspector:** penetration %, mean belief, believer histogram, spread sparkline,
  who it was sold to, evidence attached.
- **Debug console** (toggle): raw meters, event queue contents, faction aggregates.

---

## 8. MVP plan (build order)

1. Engine core: RNG, config, claim pool (~22 seed claims), population + trust network gen.
2. Belief engine + headless tests proving the six validation targets above.
3. Event queue + day tick loop.
4. Selling + faction AI + visible actions → **end-to-end loop playable headlessly**.
5. Delayed consequences: scrutiny, debunk, mutation, retaliation.
6. Forgery/evidence dial. *(deliberately after the core loop, per the brief)*
7. Pressure valves + endings.
8. Browser UI: market / portfolio / factions / chronicle / network-insight panels.
9. Balance pass via seeded headless playthroughs.

## 9. Assumption summary

- Browser SPA, not terminal (§1). Engine is UI-agnostic either way.
- 150 NPCs, 3 factions, 22 seed claims, 5 districts; turn-based days with 3 player
  actions/day. Run ends by ending-trigger or retirement; no hard day cap.
- Coin exists as a secondary resource (buying claims, forging, bribes) but *credibility
  and exposure are the real economy*, per the brief's framing.
- Trust edges are static in MVP; belief-driven edge dynamics deferred.
- Forgery ships in the same build since the loop was proven headlessly first (§8 order
  was still followed).
