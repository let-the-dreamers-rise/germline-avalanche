"use strict";

// A deliberate forgery, on a live chain, so the rejection can be shown on a
// block explorer rather than only in a test.
//
// It does what a dishonest breeder would do: commits with requestSpawn like
// anyone else, waits for the chain to fix the seed, and then reveals a genome
// of its own choosing instead of the one that seed derives. The contract
// accepts the reveal -- it cannot run the mutation itself -- and the forged
// organism is minted with a real token id. Then verify.js is run against it
// and must say FORGED. If it says GENUINE, this script exits non-zero,
// because that would mean the whole provenance claim is false.
//
// The forged organism stays on chain permanently, which is the point: anyone
// can re-run verify.js against it at any time and watch it fail.
//
//   npx hardhat run scripts/forge.js --network fuji
//   PARENT_ID=1 npx hardhat run scripts/forge.js --network fuji

const hre = require("hardhat");
const { FOUNDER, genomeRoot, phenotype } = require("../engine/genome");
const { mutate } = require("../engine/mutate");
const { evaluate } = require("../engine/fitness");
const genomes = require("../lib/genomes");
const census = require("../lib/census");
const { loadDeployment, assertChainMatches, txLink, eventFrom } = require("../lib/chain");
const { waitForSeed } = require("./breed");
const { verify } = require("./verify");

// Genomes the forger would like to claim descent for: real, honestly
// measurable configurations from the reachable gene space, just not the one
// the seed produces. The first one that is neither already born nor (by a
// fluke) the honest child is used.
const WISHES = [
  { useColour: true, useSize: true, useRing: true, ringSides: 15, useMomentum: true, unanimousOnly: true, backoff: true },
  { useColour: true, useSize: true, useRing: true, ringSides: 15, useMomentum: true, unanimousOnly: false, backoff: true },
  { useColour: true, useSize: false, useRing: true, ringSides: 15, useMomentum: true, unanimousOnly: true, backoff: true },
];

async function forge(options = {}) {
  const log = options.log || console.log;
  const network = hre.network.name;
  const record = loadDeployment(hre);
  await assertChainMatches(hre, record);
  const provider = hre.ethers.provider;
  const [signer] = await hre.ethers.getSigners();
  const germline = await hre.ethers.getContractAt("Germline", record.address, signer);

  const parentId = Number(options.parentId || process.env.PARENT_ID || 1);
  const rows = await census.readPopulation(germline);
  const parent = rows.find((row) => row.id === parentId);
  if (!parent) throw new Error("organism " + parentId + " does not exist; run found.js first");
  if (parent.remaining === 0) {
    throw new Error("organism " + parentId + " has no offspring left to spend on a forgery");
  }
  const parentGenome = genomes.get(parent.genomeRoot);

  log("network:   " + network);
  log("contract:  " + record.address);
  log("parent:    organism " + parentId + "  " + phenotype(parentGenome));
  log("");
  log("THIS IS A DELIBERATE FORGERY. It exists to be caught.");
  log("");

  const requestTx = await germline.requestSpawn(parentId);
  const requestReceipt = await requestTx.wait();
  log("requestSpawn (honest commitment)");
  log("  tx:             " + requestReceipt.hash);
  if (txLink(network, requestReceipt.hash)) log("  explorer:       " + txLink(network, requestReceipt.hash));

  const seed = await waitForSeed(germline, parentId, provider, log);
  const honestRoot = genomeRoot(mutate(parentGenome, seed));
  log("  seed:           " + seed);
  log("  honest child:   " + honestRoot + "  (not what gets revealed)");
  log("");

  let forgedGenome = null;
  for (const wish of WISHES) {
    const candidate = { ...FOUNDER, ...wish };
    const root = genomeRoot(candidate);
    if (root === honestRoot) continue;
    if (await germline.genomeSeen(root)) continue;
    forgedGenome = candidate;
    break;
  }
  if (!forgedGenome) throw new Error("every forged candidate is already born; edit WISHES");
  const forgedRoot = genomeRoot(forgedGenome);

  const spawnTx = await germline.spawn(parentId, forgedRoot);
  const spawnReceipt = await spawnTx.wait();
  const childId = Number(eventFrom(germline, spawnReceipt, "Spawned").id);
  log("spawn (forged reveal)");
  log("  forged genome:  " + phenotype(forgedGenome));
  log("  forged root:    " + forgedRoot);
  log("  organism id:    " + childId);
  log("  tx:             " + spawnReceipt.hash);
  if (txLink(network, spawnReceipt.hash)) log("  explorer:       " + txLink(network, spawnReceipt.hash));
  log("");

  // Attest the forged genome's true score, so the only lie is about descent.
  genomes.put(forgedGenome);
  const measured = evaluate(forgedGenome);
  const attestTx = await germline.attestFitness(childId, measured.fitnessBps, measured.trialId, measured.evidenceRoot);
  const attestReceipt = await attestTx.wait();
  log("attestFitness (honest score for the forged genome)");
  log("  score:          " + measured.fitnessBps + " bps");
  log("  tx:             " + attestReceipt.hash);
  log("");

  log("running verify.js against organism " + childId);
  log("");
  let caught = null;
  try {
    await verify({ childId, log });
  } catch (error) {
    if (!error.result) throw error;
    caught = error.result;
  }
  if (!caught || caught.genuine) {
    throw new Error("verify.js accepted a forged child. The provenance claim does not hold.");
  }
  log("");
  log("forgery caught: " + caught.mismatches.join(", "));

  return {
    childId,
    parentId,
    forgedRoot,
    honestRoot,
    seed,
    requestTx: requestReceipt.hash,
    spawnTx: spawnReceipt.hash,
    attestTx: attestReceipt.hash,
    verdict: caught,
  };
}

if (require.main === module) {
  forge().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { forge };
