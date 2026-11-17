"use strict";

// Tune a configuration in one command and get one JSON object back. Made for
// AI agents and scripts: no wallet, no chain, no Hardhat, nothing but JSON on
// stdout, and an exit code that says whether it worked.
//
//   npm run agent                               the example support agent
//   npm run agent -- examples/my-trial.js       your own trial
//   BUDGET=60 STRATEGY=auto npm run agent       more evaluations, pick the strategy
//
// The trial file exports { trial } built with defineTrial(); see
// examples/prompt-config.js. The search always runs against a random-sampling
// control at the same budget, and "verdict" says which won. To put the same
// kind of search on Avalanche, run `npm run try:fuji`; to check the live
// record, `npm run check`.

const { search } = require("../sdk");
const { loadTrial } = require("../lib/trial-file");

const pct = (bps) => Math.round(bps) / 100;

// The chain of parents from the founder to a given organism.
function lineageTo(population, organism) {
  const byId = new Map(population.map((o) => [o.id, o]));
  const path = [];
  for (let o = organism; o; o = byId.get(o.parent)) {
    path.unshift({ id: o.id, parent: o.parent || null, config: o.config, score: o.fitnessBps, root: o.root });
    if (!o.parent) break;
  }
  return path;
}

async function agent(options = {}) {
  const started = Date.now();
  const { trial, file } = options.trial
    ? { trial: options.trial, file: "(passed in)" }
    : loadTrial(options.trialFile);
  const budget = Number(options.budget || process.env.BUDGET || 40);
  const strategy = options.strategy || process.env.STRATEGY || "evolution";

  const run = await search(trial, { budget, strategy, salt: options.salt || trial.name + ":" + started });
  const founder = run.founder || (run.population && run.population[0]) || null;
  const start = founder ? founder.fitnessBps : null;

  return {
    ok: true,
    trial: trial.name,
    file,
    strategy: run.strategy,
    budget,
    evaluations: run.evaluations,
    ms: Date.now() - started,
    scoreUnit: "basis points (10000 = 100%)",
    start: founder ? { config: founder.config, score: start, percent: pct(start) } : null,
    best: { config: run.best.config, score: run.best.fitnessBps, percent: pct(run.best.fitnessBps), root: run.best.root },
    improvement: start === null ? null : run.best.fitnessBps - start,
    verdict: run.verdict,
    baseline: run.baseline,
    lineage: run.population ? lineageTo(run.population, run.best) : null,
    next: {
      recordOnAvalanche: "npm run try:fuji",
      checkLiveRecord: "npm run check",
    },
  };
}

if (require.main === module) {
  agent({ trialFile: process.argv[2] })
    .then((result) => {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    })
    .catch((error) => {
      process.stdout.write(JSON.stringify({ ok: false, error: error.message || String(error) }, null, 2) + "\n");
      process.exitCode = 1;
    });
}

module.exports = { agent, lineageTo };
