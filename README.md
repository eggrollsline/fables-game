# Undertow

A single-player belief-market simulation. You are an information broker in **Brack Harbor**,
a fog-bound port city where information — not money — is the currency of power. Buy raw,
unverified claims from informants; investigate, forge, sit, leak, or sell them to factions
who will act on whatever they come to believe. Nothing resolves immediately. Everything
comes back.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design: data structures, the belief
propagation rule, faction AI, the delayed-consequence event queue, and pressure valves.

## Run it

No build step, no dependencies. Serve the repo statically and open it:

```bash
npm start            # python3 http.server on :8000
# then open http://localhost:8000
```

Append `?seed=anything` to the URL to play (or replay) a specific world.

## How to play

- **Market** — buy claims from informants. Price tracks spice, not truth.
- **Portfolio** — what you hold. *Investigate* to learn a claim's true accuracy
  (true claims also yield genuine corroborating evidence). *Forge* to strengthen a claim:
  quality moves belief harder, detectability courts a public debunking that burns your
  credibility with every buyer. *Sell* to a faction, or *leak* it to the streets for free.
- **End Day** (or spacebar) — the simulation ticks: beliefs propagate through the trust
  network, decay, and suppress their contradictions; factions whose conviction crosses
  threshold schedule visible actions; scrutiny, mutations, and retaliation land from the
  event queue.
- **Trust Network** tab — every citizen, colored by belief in a selected claim. Click one
  to see *why* they believe it: last tick's social pull, decay, contradiction, and noise.
- **Debug** tab — raw meters, the event queue, and every claim's penetration/conviction.
- Get rich enough and old enough, and you can **retire**. Or let exposure, unrest, or a
  faction's total dominance end the run for you. The Chronicle is the story you caused.

## Development

```bash
npm test             # headless engine tests (node --test)
npm run playtest     # automated greedy-broker playthrough with full log
node scripts/playtest.js someseed --quiet   # balance summary only
```

The engine (`src/engine/`) is pure ES modules with no DOM dependencies; the browser UI
(`src/ui/`) is a thin renderer over it. All tuning constants live in `src/engine/config.js`.
