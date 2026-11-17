"use strict";

// The whole flow, end to end, on whatever network hardhat is pointed at, with
// a receipt at the end that lists every transaction and its explorer link.
//
//   found the founder -> breed one honest child (commit, then reveal)
//   -> verify it (GENUINE) -> forge a child -> verify it (FORGED)
//
// Exits non-zero unless the honest child verifies AND the forged one fails.
// Writes deployments/<network>-e2e.json so the result can be sent to someone
// as links rather than as a claim.
//
//   npx hardhat run scripts/deploy.js --network fuji   (once)
//   npx hardhat run scripts/e2e.js    --network fuji

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { found } = require("./found");
const { breed } = require("./breed");
const { verify } = require("./verify");
const { forge } = require("./forge");
const { loadDeployment, deploymentsDir, txLink, addressLink } = require("../lib/chain");

// About 8.5% of seeds mutate the founder into itself (see engine/mutate.js),
// and breed() rightly refuses to mint that duplicate. Nothing is minted, the
// commitment is spent, and the next block fixes a fresh seed -- so commit
// again rather than abandon a run that has already founded and paid for it.
async function breedAlive(options, log, tries = 5, breedOnce = breed) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await breedOnce(options);
    } catch (error) {
      if (!/^stillborn/.test(String(error.message)) || attempt >= tries) throw error;
      log("");
      log("stillborn on attempt " + attempt + ": that seed reproduced an existing genome.");
      log("Nothing was minted. Committing again for a fresh seed.");
      log("");
    }
  }
}

async function e2e(options = {}) {
  const log = options.log || console.log;
  const network = hre.network.name;
  const record = loadDeployment(hre);
  const section = (t) => { log(""); log("=== " + t + " ==="); log(""); };

  section("1. found");
  const founder = await found({ log });

  section("2. breed one honest child (commit, wait, reveal)");
  const child = await breedAlive({ log, parentId: founder.id }, log);

  section("3. verify the honest child");
  const genuine = await verify({ log, childId: child.childId });

  section("4. forge a child and verify it");
  const forged = await forge({ log, parentId: founder.id });

  const link = (h) => (h ? txLink(network, h) || h : null);
  const receipt = {
    network,
    chainId: record.chainId,
    contract: record.address,
    contractLink: addressLink(network, record.address),
    deployTx: link(record.deployTx),
    founder: { id: founder.id, foundTx: link(founder.foundTx), attestTx: link(founder.attestTx) },
    honestChild: {
      id: child.childId,
      requestSpawnTx: link(child.requestTx),
      spawnTx: link(child.spawnTx),
      attestTx: link(child.attestTx),
      verdict: genuine.genuine ? "GENUINE" : "FORGED",
    },
    forgedChild: {
      id: forged.childId,
      requestSpawnTx: link(forged.requestTx),
      spawnTx: link(forged.spawnTx),
      attestTx: link(forged.attestTx),
      verdict: forged.verdict.genuine ? "GENUINE" : "FORGED",
      failed: forged.verdict.mismatches,
    },
    ranAt: new Date().toISOString(),
  };

  const file = path.join(deploymentsDir(), network + "-e2e.json");
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + "\n");

  section("result");
  log("honest child #" + child.childId + ": " + receipt.honestChild.verdict);
  log("forged child #" + forged.childId + ": " + receipt.forgedChild.verdict);
  log("receipt written to " + file);
  if (!genuine.genuine || forged.verdict.genuine) {
    throw new Error("end-to-end check failed");
  }
  return receipt;
}

if (require.main === module) {
  e2e().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { e2e, breedAlive };
