"use strict";

// Try Germline on your own trial, from your own wallet, in one command.
//
//   npm run try:local     no wallet, no tokens: an in-process chain, ~10 s
//   npm run try:fuji      Avalanche Fuji, from the key in .env
//
// What it does:
//   1. loads a trial -- examples/prompt-config.js unless TRIAL names another
//      file that exports { trial } built with defineTrial();
//   2. deploys a Germline registry that you own, with the founder's own
//      measured score as its survival threshold (or reuses TRY_CONTRACT);
//   3. records the search on chain as it runs: the founder, then every child
//      by commit-reveal, seeded from a block hash that did not exist when you
//      committed, each with its attested score;
//   4. reads every organism back from the chain and re-derives it from its
//      parent and the on-chain seed, and re-measures its score, so the run
//      ends with a verdict per organism rather than a claim.
//
// Settings, all optional, in .env or the environment:
//   TRIAL=examples/pricing-rules.js   a file exporting { trial }
//   GENERATIONS=4                     rounds of breeding (each child is 3 tx)
//   TRY_CONTRACT=0x...                record into a registry you already own
//   TRY_FECUNDITY=3                   children per viable organism at threshold

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { optimise } = require("../sdk");
const { verifyLineage } = require("../sdk/verify");
const { deploymentsDir, hardenProvider, txLink, addressLink } = require("../lib/chain");
const { loadTrial } = require("../lib/trial-file");

const FAUCET = "https://build.avax.network/console/primary-network/faucet";

// Roughly what a default run costs, in gas: a deploy, a founder, and up to a
// dozen children at three transactions each. Used only to stop early with a
// useful message instead of failing halfway through for want of gas.
const GAS_BUDGET = 10000000n;

// A local chain only mines when a transaction arrives, but commit-reveal has
// to wait for the next block to exist. On a live chain that happens by
// itself; here something has to tick.
function startBlockPump(network) {
  if (network !== "hardhat") return () => {};
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    hre.network.provider.send("evm_mine", []).catch(() => {});
  }, 50);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function formatAvax(wei) {
  return Number(hre.ethers.formatEther(wei)).toFixed(4);
}

async function checkFunds(provider, address, network, log) {
  const balance = await provider.getBalance(address);
  if (network === "hardhat") return balance;
  const fee = await provider.getFeeData();
  const price = fee.gasPrice || fee.maxFeePerGas || 0n;
  const needed = price * GAS_BUDGET;
  log("wallet           " + address);
  log("balance          " + formatAvax(balance) + " AVAX");
  if (balance < needed) {
    throw new Error(
      "this wallet has " +
        formatAvax(balance) +
        " AVAX on " +
        network +
        ", and a run needs about " +
        formatAvax(needed) +
        ".\nGet test AVAX for " +
        address +
        " at " +
        FAUCET +
        "\n(or ask whoever sent you this for 0.1 test AVAX), then run this again."
    );
  }
  return balance;
}

async function registryFor(trial, signer, network, options, log) {
  const address = options.contract || process.env.TRY_CONTRACT;
  if (address) {
    const contract = await hre.ethers.getContractAt("Germline", address, signer);
    const curator = await contract.curator();
    const me = await signer.getAddress();
    if (curator.toLowerCase() !== me.toLowerCase()) {
      throw new Error(
        "TRY_CONTRACT " +
          address +
          " is curated by " +
          curator +
          ", not by this wallet (" +
          me +
          "). Only the curator can found a new lineage there. Leave " +
          "TRY_CONTRACT unset and a registry of your own is deployed."
      );
    }
    log("registry         " + address + " (yours, reused)");
    return { contract, address, deployTx: null, reused: true };
  }

  // The founder's own score is the bar its descendants have to clear, the
  // same rule optimise() uses when no chain is involved.
  const founder = await trial.evaluate(trial.seed);
  if (!founder.ok) {
    throw new Error("the trial's seed configuration failed to evaluate: " + founder.error);
  }
  const threshold = founder.fitnessBps;
  const fecundity = Number(options.fecundity || process.env.TRY_FECUNDITY || 3);
  const Germline = await hre.ethers.getContractFactory("Germline", signer);
  const contract = await Germline.deploy(threshold, 500, fecundity);
  await contract.waitForDeployment();
  const deployed = await contract.getAddress();
  const deployTx = contract.deploymentTransaction().hash;
  log("registry         " + deployed + " (deployed now, you are its curator)");
  log("  survival bar   " + threshold + " bps, the founder's own score");
  if (txLink(network, deployTx)) log("  explorer       " + addressLink(network, deployed));
  return { contract, address: deployed, deployTx, reused: false };
}

// Optimise logs "(tx 0x...)"; on a network with an explorer, make each one
// a link and remember it for the receipt.
function linking(network, log, hashes) {
  return (line) => {
    const match = /\(tx (0x[0-9a-fA-F]{64})\)/.exec(line);
    if (match) hashes.push(match[1]);
    const link = match && txLink(network, match[1]);
    log(link ? line.replace(match[0], "(" + link + ")") : line);
  };
}

// The same check web/try.html runs in the browser; see sdk/verify.js.
const verifyRun = verifyLineage;

async function tryIt(options = {}) {
  const log = options.log || console.log;
  const network = hre.network.name;
  if (network === "avalanche" && process.env.TRY_MAINNET !== "1") {
    throw new Error(
      "this would spend real AVAX on C-Chain mainnet. Try it on Fuji first " +
        "(npm run try:fuji); set TRY_MAINNET=1 if you really mean mainnet."
    );
  }
  if (network !== "hardhat") hardenProvider(hre);

  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "no wallet key for " +
        network +
        ". Put DEPLOYER_KEY=0x... in a .env file in this folder. Use a fresh " +
        "test wallet, never one that holds real funds."
    );
  }
  const signer = signers[0];
  const provider = hre.ethers.provider;
  const { trial, file } = options.trial
    ? { trial: options.trial, file: "(passed in)" }
    : loadTrial(options.trialFile);
  const generations = Number(options.generations || process.env.GENERATIONS || 4);

  const section = (title) => { log(""); log("=== " + title + " ==="); log(""); };
  section("Germline: try it on " + network);
  log("trial            " + trial.name + "  (" + file + ")");
  log("generations      " + generations);
  await checkFunds(provider, await signer.getAddress(), network, log);

  section("1. your registry");
  const registry = await registryFor(trial, signer, network, options, log);

  section("2. search, recorded on chain as it runs");
  const hashes = [];
  const stopPump = startBlockPump(network);
  let run;
  try {
    run = await optimise(trial, {
      generations,
      log: linking(network, log, hashes),
      chain: {
        contract: registry.contract,
        signer,
        pollMs: network === "hardhat" ? 25 : 2000,
        pollTries: network === "hardhat" ? 400 : 60,
      },
    });
  } finally {
    stopPump();
  }

  section("3. verify every organism against the chain");
  const checks = await verifyRun(trial, registry.contract, run.population);
  for (const c of checks) {
    log(
      "organism " +
        c.id +
        (c.parent ? " (child of " + c.parent + ")" : " (founder)") +
        "  " +
        c.label +
        "  " +
        c.fitnessBps +
        " bps" +
        "  heredity " +
        (c.heredity === null ? "n/a" : c.heredity ? "VERIFIED" : "FAILED") +
        "  score " +
        (c.attested ? (c.scoreHolds && c.evidenceHolds ? "VERIFIED" : "FAILED") : "not attested") +
        "  -> " +
        c.verdict
    );
  }

  const founder = run.founder;
  const best = run.best;
  const genuine = checks.filter((c) => c.verdict === "GENUINE").length;
  const children = checks.filter((c) => c.parent).length;
  const contractLink = addressLink(network, registry.address);

  const receipt = {
    network,
    chainId: Number((await provider.getNetwork()).chainId),
    trial: trial.name,
    wallet: await signer.getAddress(),
    registry: registry.address,
    registryLink: contractLink,
    deployTx: registry.deployTx ? txLink(network, registry.deployTx) || registry.deployTx : null,
    transactions: hashes.map((h) => txLink(network, h) || h),
    founder: { config: founder.config, fitnessBps: founder.fitnessBps },
    best: { config: best.config, fitnessBps: best.fitnessBps, label: best.label },
    organisms: checks,
    ranAt: new Date().toISOString(),
  };
  const tag = receipt.wallet.slice(2, 8).toLowerCase();
  const file2 = path.join(deploymentsDir(), network + "-try-" + tag + ".local.json");
  fs.mkdirSync(path.dirname(file2), { recursive: true });
  fs.writeFileSync(file2, JSON.stringify(receipt, null, 2) + "\n");

  section("result");
  log("registry         " + (contractLink || registry.address));
  log("on chain         " + checks.length + " organisms (" + children + " bred by commit-reveal), " +
    hashes.length + (registry.deployTx ? " + 1 deploy" : "") + " transactions from your wallet");
  log("verified         " + genuine + " of " + checks.length + " GENUINE");
  log("started at       " + founder.label + "  " + founder.fitnessBps + " bps");
  log("best found       " + best.label + "  " + best.fitnessBps + " bps (" +
    (best.fitnessBps - founder.fitnessBps >= 0 ? "+" : "") + (best.fitnessBps - founder.fitnessBps) + ")");
  log("receipt          " + file2);
  if (contractLink) {
    log("");
    log("Share this link. Every transaction above is on that page:");
    log("  " + contractLink);
  }

  if (genuine !== checks.length) {
    const error = new Error("some organisms did not verify against the chain");
    error.receipt = receipt;
    throw error;
  }
  return receipt;
}

if (require.main === module) {
  tryIt().catch((error) => {
    console.error("");
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { tryIt, loadTrial, verifyRun };
