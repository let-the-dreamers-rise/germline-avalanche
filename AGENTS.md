# Germline for agents

Two commands, each one JSON object on stdout and an exit code. No wallet, no
gas, no Hardhat. Run `npm install` once.

## Tune a configuration: `npm run agent`

```
npm run --silent agent                              # the example support agent
npm run --silent agent -- examples/my-trial.js      # your own trial
BUDGET=60 STRATEGY=auto npm run --silent agent
```

Takes well under a second on the examples (the search itself is milliseconds;
your own `evaluate` sets the real pace). Returns:

- `best.config`, `best.score` (basis points, 10000 = 100%), `best.percent`, `best.root`
- `start`, `improvement`
- `verdict.winner`: `search`, `random` or `tied`. The search always runs
  against random sampling at the same budget, and says honestly which won.
- `lineage`: every step from the starting config to the best, each with its parent
- exit 0 with `ok: true`, or exit 1 with `ok: false` and `error`

A trial file exports `{ trial }` built with `defineTrial()`. Copy
`examples/prompt-config.js` and change `genes`, `seed` and `evaluate`.

## Check the live Avalanche record: `npm run check`

```
npm run --silent check            # honest child #2 and forged child #3 on Fuji
npm run --silent check -- 3       # one child
RPC=https://... npm run --silent check
```

Reads the registry on Avalanche Fuji from a public RPC, re-runs the mutation
the chain seeded, recomputes the seed from the block hash, and re-measures the
score. Takes seconds. Returns each child's `verdict` (`GENUINE` or `FORGED`),
which check failed, and `ok: true` only when every verdict matches the record
in `deployments/fuji-e2e.json`. Exit 0 when it matches, 1 when it doesn't, 2
when no RPC answered.

## Record on chain

Recording needs transactions, so it needs a funded test wallet:
`npm run wallet`, free test AVAX from the faucet, then `npm run try:fuji`. See
[docs/TRY.md](docs/TRY.md).
