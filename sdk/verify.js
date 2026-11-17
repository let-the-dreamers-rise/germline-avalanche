"use strict";

// Check a recorded search against the chain.
//
// optimise() with provenance on leaves one organism per configuration on
// chain: a root, the parent it descends from, the seed the contract fixed,
// and an attested score. This reads each of those back and checks it without
// trusting anything the run itself remembers except the configurations,
// which are what a root is the hash of:
//
//   root      the configuration hashes to the root on chain;
//   heredity  the trial's mutation of the parent's configuration under the
//             on-chain seed is exactly this configuration (the only thing a
//             breeder chooses is the root it reveals, so this is the check
//             that catches a forged reveal);
//   score     evaluate() gives the attested score, with the same evidence.
//
// Used by scripts/try.js and by the browser page in web/try.html.

/// `population` is optimise()'s run.population, or anything with the same
/// shape: { id, onChainId, parent, config, label, fitnessBps } per member.
async function verifyLineage(trial, contract, population) {
  const byId = new Map(population.map((o) => [o.id, o]));
  const results = [];
  for (const member of population) {
    if (member.onChainId == null) continue;
    const organism = await contract.organismOf(member.onChainId);
    const onChainRoot = String(organism.genomeRoot).toLowerCase();
    const rootHolds = trial.root(member.config).toLowerCase() === onChainRoot;

    let heredity = null;
    if (member.parent) {
      const parent = byId.get(member.parent);
      const derived = trial.mutate(parent.config, organism.mutationSeed);
      heredity = trial.root(derived).toLowerCase() === onChainRoot;
    }

    const fitness = await contract.fitnessOf(member.onChainId);
    const measured = await trial.evaluate(member.config);
    const attested = BigInt(fitness.attestedAt) !== 0n;
    const scoreHolds = !attested || Number(fitness.score) === measured.fitnessBps;
    const evidenceHolds =
      !attested ||
      String(fitness.evidenceRoot).toLowerCase() === String(measured.evidenceRoot).toLowerCase();

    const genuine = rootHolds && heredity !== false && scoreHolds && evidenceHolds;
    results.push({
      id: member.onChainId,
      parent: member.parent ? byId.get(member.parent).onChainId : 0,
      label: member.label,
      fitnessBps: member.fitnessBps,
      seed: String(organism.mutationSeed),
      attested,
      heredity,
      scoreHolds,
      evidenceHolds,
      verdict: genuine ? "GENUINE" : "FORGED",
    });
  }
  return results;
}

module.exports = { verifyLineage };
