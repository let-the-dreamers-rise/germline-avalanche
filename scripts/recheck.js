"use strict";

// Re-check a recorded end-to-end run, read-only, from a clean machine.
//
// e2e.js writes deployments/<network>-e2e.json: which organisms it bred and
// the verdict each one got. This reads that receipt back and asks the chain
// again. The honest child must still verify as GENUINE, and the forged child
// must still be rejected as FORGED -- for the recorded reason, with everything
// else about it reproducing. No key and no gas: it only reads, so anyone can
// run it, and so can CI.
//
//   npx hardhat run scripts/recheck.js --network fuji
//
// Exits non-zero if either verdict has changed or a check could not be
// completed. "Could not check" is never counted as "FORGED": an RPC failure
// must not be allowed to pass for the forgery being caught.

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { verify } = require("./verify");
const { deploymentsDir, loadDeployment, addressLink } = require("../lib/chain");

function loadReceipt(network) {
  const file = path.join(deploymentsDir(), network + "-e2e.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      "no end-to-end receipt for network '" +
        network +
        "'.\nExpected " +
        file +
        "\nRun the flow first:  npx hardhat run scripts/e2e.js --network " +
        network
    );
  }
  const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!receipt.honestChild || !receipt.forgedChild) {
    throw new Error("the receipt at " + file + " names no honest or forged child");
  }
  return receipt;
}

// verify() throws on a forged organism and attaches what it found. Anything
// thrown without a result is a failure to check, not a verdict, and is
// re-thrown untouched.
async function verdictFor(childId, log) {
  try {
    return await verify({ log, childId });
  } catch (error) {
    if (!error.result) throw error;
    return error.result;
  }
}

function sameSet(a, b) {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((value, i) => value === y[i]);
}

function mark(holds) {
  return holds ? "reproduces" : "FAILS";
}

function row(label, result) {
  const seed = result.seed ? mark(result.seed.holds) : "not re-derived";
  const score = result.fitness ? mark(result.fitness.scoreHolds) : "not attested";
  const evidence = result.fitness ? mark(result.fitness.evidenceHolds) : "not attested";
  return (
    "| " +
    [
      label + " #" + result.childId,
      result.genuine ? "GENUINE" : "FORGED",
      mark(result.heredity.holds),
      seed,
      score,
      evidence,
    ].join(" | ") +
    " |"
  );
}

async function recheck(options = {}) {
  const log = options.log || console.log;
  const network = hre.network.name;
  const record = loadDeployment(hre);
  const receipt = options.receipt || loadReceipt(network);
  const section = (title) => { log(""); log("=== " + title + " ==="); log(""); };

  section("honest child #" + receipt.honestChild.id);
  const honest = await verdictFor(receipt.honestChild.id, log);

  section("forged child #" + receipt.forgedChild.id);
  const forged = await verdictFor(receipt.forgedChild.id, log);

  const problems = [];

  if (!honest.genuine) {
    problems.push(
      "honest child #" + honest.childId + " no longer verifies: " +
        honest.mismatches.join(", ") + " failed to reproduce"
    );
  }
  if (forged.genuine) {
    problems.push("forged child #" + forged.childId + " verified as GENUINE");
  } else {
    const expected = receipt.forgedChild.failed || ["heredity"];
    if (!sameSet(forged.mismatches, expected)) {
      problems.push(
        "forged child #" + forged.childId + " fails on [" +
          forged.mismatches.join(", ") + "], but the receipt recorded [" +
          expected.join(", ") + "]"
      );
    }
  }
  // The seed is the commit-reveal half of the claim. verify.js treats it as
  // best effort because a node may stop serving old logs; a re-check that
  // could not re-derive it has not re-checked the commit-reveal, so here it
  // is a failure rather than a footnote.
  for (const [label, result] of [["honest", honest], ["forged", forged]]) {
    if (!result.seed) {
      problems.push(
        "the " + label + " child's seed could not be re-derived from the chain, " +
          "so its commit-reveal was not re-checked"
      );
    }
  }

  const ok = problems.length === 0;
  const contractLink = addressLink(network, record.address);

  const summary = [
    "## Germline on " + network + ": live re-check " + (ok ? "passed" : "FAILED"),
    "",
    "| organism | verdict | heredity | seed | score | evidence |",
    "|---|---|---|---|---|---|",
    row("honest child", honest),
    row("forged child", forged),
    "",
    "Contract: " +
      (contractLink ? "[" + record.address + "](" + contractLink + ")" : record.address) +
      " (chain " + record.chainId + ")",
    "",
    "Read-only: no key and no gas. The forged child's reveal transaction " +
      "succeeds on chain by design; what fails is re-deriving that child from " +
      "its parent and the on-chain seed, which anyone can do.",
  ];
  if (!ok) {
    summary.push("", "Problems:", ...problems.map((p) => "- " + p));
  }

  section("result");
  log("honest child #" + honest.childId + ": " + (honest.genuine ? "GENUINE" : "FORGED"));
  log(
    "forged child #" + forged.childId + ": " +
      (forged.genuine ? "GENUINE" : "FORGED (" + forged.mismatches.join(", ") + ")")
  );
  for (const problem of problems) log("PROBLEM: " + problem);
  log(ok ? "RE-CHECK PASSED" : "RE-CHECK FAILED");

  // GitHub Actions renders this file on the run's page, so the verdicts are
  // readable without opening a log.
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join("\n") + "\n");
  }

  const result = { ok, network, contract: record.address, honest, forged, problems };
  if (!ok) {
    const error = new Error("re-check failed: " + problems.join("; "));
    error.result = result;
    throw error;
  }
  return result;
}

if (require.main === module) {
  recheck().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { recheck };
