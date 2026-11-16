"use strict";

// The chain-side plumbing every lifecycle script needs: which contract, on
// which chain, how to read what a transaction did, and how to point a person
// at it afterwards. None of this is clever; it is here so that four scripts
// fail in the same clear way rather than four different obscure ones.

const fs = require("fs");
const path = require("path");

// Overridable for the same reason the genome cache is: a test lineage must
// not overwrite the record of a real deployment.
function deploymentsDir() {
  return (
    process.env.GERMLINE_DEPLOYMENTS || path.join(__dirname, "..", "deployments")
  );
}

// Only networks whose explorer we can actually name. Printing a guessed URL
// would be worse than printing none, because a judge who clicks it and gets
// nothing has learned something false about the rest of the output.
const EXPLORERS = {
  zerog: "https://chainscan.0g.ai",
  galileo: "https://chainscan-galileo.0g.ai",
  avalanche: "https://snowtrace.io",
  fuji: "https://testnet.snowtrace.io",
};

/// Read the deployment record for the network hardhat was pointed at.
function loadDeployment(hre) {
  const network = hre.network.name;
  const file = path.join(deploymentsDir(), network + ".json");
  if (!fs.existsSync(file)) {
    throw new Error(
      "no deployment recorded for network '" +
        network +
        "'.\nExpected " +
        file +
        "\nDeploy first:  npx hardhat run scripts/deploy.js --network " +
        network
    );
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(
      "the deployment record at " + file + " is not valid JSON: " + error.message
    );
  }
  if (!record.address) {
    throw new Error(
      "the deployment record at " + file + " has no contract address in it"
    );
  }
  return record;
}

/// Refuse to act if the RPC is not the chain the record was written on. An
/// address is only meaningful on one chain, and sending a transaction to the
/// same address on another is how real money gets burned.
async function assertChainMatches(hre, record) {
  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  if (record.chainId && chainId !== record.chainId) {
    throw new Error(
      "the RPC for network '" +
        hre.network.name +
        "' reports chain " +
        chainId +
        ", but the deployment record says chain " +
        record.chainId +
        ". Refusing to act: " +
        record.address +
        " is an address on a different chain."
    );
  }
  return chainId;
}

function explorerBase(network) {
  return EXPLORERS[network] || null;
}

function txLink(network, hash) {
  const base = explorerBase(network);
  return base ? base + "/tx/" + hash : null;
}

function addressLink(network, address) {
  const base = explorerBase(network);
  return base ? base + "/address/" + address : null;
}

/// The first event of the given name in a receipt, decoded. Reading the
/// return value of a state-changing call is not possible from outside, so the
/// events are how a script learns the id it just created.
function eventFrom(contract, receipt, name) {
  for (const entry of receipt.logs) {
    // Logs from other contracts touched by the same transaction do not parse
    // against this interface, and that is not an error worth raising.
    let parsed = null;
    try {
      parsed = contract.interface.parseLog(entry);
    } catch (error) {
      continue;
    }
    if (parsed && parsed.name === name) return parsed.args;
  }
  throw new Error(
    "transaction " +
      receipt.hash +
      " emitted no " +
      name +
      " event, so the call did not do what this script assumed it did"
  );
}

/// The name of the custom error a call reverted with, or null if the failure
/// was something other than a revert. Poll loops have to tell "not yet" from
/// "the network is down", and the difference is exactly this name.
function revertName(error) {
  if (!error) return null;
  if (error.revert && error.revert.name) return error.revert.name;
  const message = String(error.shortMessage || error.message || "");
  const match = message.match(/custom error '([A-Za-z0-9_]+)/);
  return match ? match[1] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/// Public RPCs throttle. Fuji's answers "Too Many Requests" once a verifier
/// sends a burst of log queries, and that is a reason to wait, not to give up
/// or to shrink the query (which only sends more requests).
function isRateLimit(error) {
  const text = String(
    (error && (error.shortMessage || error.message)) || ""
  ) + " " + JSON.stringify((error && (error.info || error.error)) || {});
  return /too many requests|rate.?limit|\b429\b/i.test(text);
}

/// A provider refusing the size of a log query, as opposed to throttling it.
function isRangeError(error) {
  if (isRateLimit(error)) return false;
  const text = String((error && (error.shortMessage || error.message)) || "");
  return /range|too large|too many (blocks|results)|exceed|limit/i.test(text);
}

/// Retry fn while the provider is throttling, backing off each time.
async function withRetry(fn, options = {}) {
  const tries = Number(options.tries || process.env.GERMLINE_RPC_TRIES || 7);
  let delay = Number(options.delay || process.env.GERMLINE_RPC_DELAY_MS || 500);
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimit(error) || attempt >= tries) throw error;
      await sleep(delay);
      delay = Math.min(delay * 2, 10000);
    }
  }
}

/// queryFilter, but in windows. Public RPCs cap eth_getLogs ranges: the
/// Avalanche Fuji endpoint refuses anything wider than 100 blocks (as of
/// Nov 2026), so asking for "every event since block 0" works on a local
/// chain and fails on Fuji. Windows are 99 blocks (the range is inclusive,
/// so 99 asks for 100). A refused range halves the window; a throttled
/// request waits and retries the same window.
async function queryAll(contract, filter, options = {}) {
  const provider = contract.runner.provider || contract.runner;
  const latest =
    options.toBlock != null
      ? Number(options.toBlock)
      : await withRetry(() => provider.getBlockNumber());
  const from = Math.max(
    0,
    Number(options.fromBlock || process.env.GERMLINE_FROM_BLOCK || 0)
  );
  let span = Number(options.span || process.env.GERMLINE_LOG_SPAN || 99);
  const pause = Number(process.env.GERMLINE_LOG_PAUSE_MS || 120);
  if (latest < from) return [];
  if (latest - from <= span) {
    return withRetry(() => contract.queryFilter(filter, from, latest));
  }
  const out = [];
  let start = from;
  while (start <= latest) {
    const end = Math.min(start + span, latest);
    try {
      out.push(
        ...(await withRetry(() => contract.queryFilter(filter, start, end)))
      );
      start = end + 1;
      if (start <= latest && pause > 0) await sleep(pause);
    } catch (error) {
      if (!isRangeError(error) || span <= 1) throw error;
      span = Math.max(1, Math.floor(span / 2));
    }
  }
  return out;
}

/// The first block at or after a timestamp, by binary search. The contract
/// records when an organism was born but not in which block, and on a public
/// RPC it is far cheaper to find that block (about twenty reads) than to scan
/// every log since deployment.
async function firstBlockAtOrAfter(provider, timestamp, lo, hi) {
  let low = Number(lo);
  let high = Number(hi);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const block = await withRetry(() => provider.getBlock(mid));
    if (Number(block.timestamp) < Number(timestamp)) low = mid + 1;
    else high = mid;
  }
  return low;
}

module.exports = {
  deploymentsDir,
  loadDeployment,
  assertChainMatches,
  explorerBase,
  txLink,
  addressLink,
  eventFrom,
  revertName,
  sleep,
  queryAll,
  withRetry,
  isRateLimit,
  firstBlockAtOrAfter,
};
