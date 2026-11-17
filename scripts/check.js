"use strict";

// Re-check the live Germline record on Avalanche Fuji in seconds, and get one
// JSON object back. Read-only: no wallet, no gas, no Hardhat, just ethers over
// a public RPC. Made for AI agents and scripts as much as for people.
//
//   npm run check              both recorded children (honest #2, forged #3)
//   npm run check -- 3         one child
//   RPC=https://... npm run check
//
// For each child it re-runs the mutation the chain seeded on the parent,
// recomputes the seed from the block hash the commitment named, and
// re-measures the attested score (sdk/live-check.js, the same checks as
// scripts/verify.js). It exits 0 only when every verdict matches the
// recorded one in deployments/fuji-e2e.json: the honest child GENUINE, the
// forged child FORGED.

const { ethers } = require("ethers");
const { checkLive } = require("../sdk/live-check");
const { withRetry } = require("../lib/chain");
const receipt = require("../deployments/fuji-e2e.json");

const RPCS = [
  "https://api.avax-test.network/ext/bc/C/rpc",
  "https://avalanche-fuji-c-chain-rpc.publicnode.com",
];

// Only what the check reads, so a fresh clone needs no compile step.
const ABI = [
  "function organismOf(uint256 id) view returns (tuple(uint256 parent, uint32 generation, uint32 offspring, uint64 bornAt, bytes32 genomeRoot, bytes32 mutationSeed, address steward, uint256 agenticId))",
  "function fitnessOf(uint256 id) view returns (tuple(uint64 score, uint64 attestedAt, bytes32 trialId, bytes32 evidenceRoot, address attestor))",
  "event SpawnRequested(uint256 indexed parent, uint256 requestBlock)",
];

const hashOf = (value) => {
  const match = /0x[0-9a-fA-F]{64}/.exec(String(value || ""));
  return match ? match[0] : null;
};

// A provider whose every call waits out a public RPC's throttling.
function patientProvider(url, chainId) {
  const provider = new ethers.JsonRpcProvider(url, chainId, { staticNetwork: true, batchMaxCount: 1 });
  const send = provider.send.bind(provider);
  provider.send = (method, params) => withRetry(() => send(method, params), { tries: 6, delay: 400 });
  return provider;
}

async function check(options = {}) {
  const started = Date.now();
  const record = options.receipt || receipt;
  const entries = [record.honestChild, record.forgedChild].filter(
    (c) => options.childId == null || Number(c.id) === Number(options.childId)
  );
  if (entries.length === 0) throw new Error("child " + options.childId + " is not in the recorded receipt");

  const rpcs = options.rpc ? [options.rpc] : process.env.RPC ? [process.env.RPC] : RPCS;
  let lastError = null;
  for (const url of rpcs) {
    try {
      const provider = options.provider || patientProvider(url, record.chainId);
      const contract = new ethers.Contract(record.contract, options.abi || ABI, provider);
      const children = await Promise.all(
        entries.map(async (entry) => {
          const result = await checkLive({ contract, provider, childId: entry.id, requestTx: hashOf(entry.requestSpawnTx) });
          return { ...result, expected: entry.verdict, matchesRecord: result.verdict === entry.verdict };
        })
      );
      return {
        ok: children.every((c) => c.matchesRecord),
        network: record.network,
        chainId: record.chainId,
        contract: record.contract,
        explorer: record.contractLink || null,
        rpc: options.provider ? "(passed in)" : url,
        ms: Date.now() - started,
        children,
      };
    } catch (error) {
      lastError = error;
      if (options.provider) break;
    }
  }
  throw lastError || new Error("no RPC answered");
}

if (require.main === module) {
  check({ childId: process.argv[2] })
    .then((result) => {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      process.stdout.write(JSON.stringify({ ok: false, error: error.shortMessage || error.message || String(error) }, null, 2) + "\n");
      process.exitCode = 2;
    });
}

module.exports = { check, ABI };
