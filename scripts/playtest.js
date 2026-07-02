// Headless automated playthrough for balance checking.
// Usage: node scripts/playtest.js [seed] [--quiet]
// Plays a greedy broker: buy the spiciest affordable claim, investigate,
// forge on fabrications, sell to the most credulous interested faction, leak.

import { newGame, buyClaim, investigateClaim, forgeEvidence, sellClaim, leakClaim, layLow, endDay, canRetire, retire } from '../src/engine/game.js';
import { FACTIONS } from '../src/engine/data.js';
import { claimStats } from '../src/engine/beliefs.js';

const seed = process.argv[2] || 'playtest';
const quiet = process.argv.includes('--quiet');
const s = newGame(seed);
let printed = 0;

function flushLog() {
  if (quiet) return;
  for (; printed < s.chronicle.length; printed++) {
    const e = s.chronicle[printed];
    console.log(`  [d${String(e.day).padStart(2)}] (${e.kind}) ${e.text}`);
  }
}

const leaked = new Map(); // claimId -> times leaked

function act() {
  const owned = s.claims.filter((c) => c.status === 'owned');
  // 0. self-preservation
  if (s.player.exposure > 55 && s.player.coin >= 15) return layLow(s);
  // 1. investigate anything unexamined
  for (const c of owned) {
    if (!c.investigated && s.player.coin >= 10) return investigateClaim(s, c.id);
  }
  // 2. forge for known fabrications (careful tier)
  for (const c of owned) {
    if (c.investigated && c.trueAccuracy < 0.4 && !c.evidence.length && s.player.coin >= 20) {
      return forgeEvidence(s, c.id, 0);
    }
  }
  // 3. sell investigated claims to an interested faction
  for (const c of owned) {
    if (!c.investigated) continue;
    const buyer = FACTIONS.find((f) => f.interests.includes(c.topic) && !c.soldTo.includes(f.id) && f.id !== c.about);
    if (buyer) return sellClaim(s, c.id, buyer.id);
  }
  // 4. buy the spiciest affordable market claim
  const market = s.claims.filter((c) => c.status === 'market' && c.price <= s.player.coin)
    .sort((a, b) => b.spice - a.spice);
  if (market.length) return buyClaim(s, market[0].id);
  // 5. otherwise leak something sold to keep it moving (at most twice per claim)
  const sold = s.claims.filter((c) => c.status === 'sold' && (leaked.get(c.id) || 0) < 2);
  if (sold.length) {
    leaked.set(sold[0].id, (leaked.get(sold[0].id) || 0) + 1);
    return leakClaim(s, sold[0].id);
  }
  return null;
}

const MAX_DAYS = 45;
while (!s.ending && s.day <= MAX_DAYS) {
  while (s.player.actionsLeft > 0) {
    const r = act();
    if (!r || !r.ok) break;
  }
  if (canRetire(s)) { retire(s); break; }
  endDay(s);
  flushLog();
}
flushLog();

console.log('\n=== RUN SUMMARY ===');
console.log(`seed=${seed} day=${s.day} ending=${s.ending ? s.ending.title : '(none, day cap)'}`);
console.log(`coin=${s.player.coin} exposure=${s.player.exposure.toFixed(1)} notoriety=${s.city.notoriety} unrest=${s.city.unrest.toFixed(1)}`);
console.log(`credibility: ${Object.entries(s.player.credibility).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`faction power: ${s.factions.map((f) => `${f.id}=${f.power.toFixed(0)}`).join(' ')}`);
console.log(`claims: total=${s.claims.length} circulating=${s.claims.filter((c) => ['circulating', 'sold'].includes(c.status)).length} debunked=${s.claims.filter((c) => c.status === 'debunked').length} mutations=${s.claims.filter((c) => c.originId).length}`);
const kinds = {};
for (const e of s.chronicle) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
console.log(`chronicle: ${Object.entries(kinds).map(([k, v]) => `${k}=${v}`).join(' ')}`);
for (const c of s.claims.filter((x) => ['circulating', 'sold'].includes(x.status)).slice(0, 6)) {
  const st = claimStats(c);
  console.log(`  claim ${c.id}: pen=${(st.penetration * 100).toFixed(0)}% mean=${st.meanBelief.toFixed(2)} "${c.headline.slice(0, 60)}"`);
}
