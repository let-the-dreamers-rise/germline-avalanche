"use strict";

// Check one organism of a live registry using nothing but public reads.
//
// The same three checks as scripts/verify.js, without Hardhat, so a browser
// can run them against Avalanche from a public RPC with no wallet:
//
//   1. heredity: re-run the mutation the chain seeded on the parent and
//      compare the result with the root the chain minted;
//   2. the seed: recompute it from the hash of the block the commitment was
//      made in, so the seed is not merely trusted as recorded;
//   3. the score: re-measure the genome the chain records and compare it
//      with the attested score and evidence root.
//
// The chain stores only roots. The configuration behind a root is recovered
// from the enumerated gene space (engine/space.js), so nothing has to be
// requested from whoever bred the lineage.

const { ethers } = require("ethers");
const { genomeRoot, phenotype } = require("../engine/genome");
const { mutate } = require("../engine/mutate");
const { genomeForRoot } = require("../engine/space");
const { evaluate } = require("../engine/fitness");

// The commitment's block: the block of the transaction that made it, read
// from the SpawnRequested event it emitted when that is present.
async function requestBlockOf(contract, provider, requestTx) {
  const receipt = await provider.getTransactionReceipt(requestTx);
  if (!receipt) throw new Error("request transaction " + requestTx + " not found");
  for (const entry of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(entry);
      if (parsed && parsed.name === "SpawnRequested") return Number(parsed.args.requestBlock);
    } catch (error) {
      // Not one of this contract's events.
    }
  }
  return receipt.blockNumber;
}

// How many siblings the parent had already produced when this child was
// born. Ids only increase, so it is the count of organisms between the two
// that name the same parent.
async function ordinalOf(contract, parentId, childId) {
  const ids = [];
  for (let id = parentId + 1; id < childId; id++) ids.push(id);
  const siblings = await Promise.all(ids.map((id) => contract.organismOf(id)));
  return siblings.filter((s) => Number(s.parent) === parentId).length;
}

/// contract: an ethers Contract for Germline on a read-only provider.
/// requestTx: the hash of the requestSpawn transaction that seeded this
/// child, which lets the seed check skip a log scan. Without it the seed is
/// reported as not checked rather than guessed.
async function checkLive({ contract, provider, childId, requestTx, log }) {
  const say = log || function () {};
  childId = Number(childId);
  const child = await contract.organismOf(childId);
  const parentId = Number(child.parent);
  if (parentId === 0) throw new Error("organism " + childId + " is a founder; it has no parent to derive from");
  say("read organism " + childId + " from the chain");

  // Everything else depends only on the child, so ask for it all at once:
  // one round trip of waiting instead of six on a slow public RPC.
  const [parent, fitness, seedInputs] = await Promise.all([
    contract.organismOf(parentId),
    contract.fitnessOf(childId),
    requestTx
      ? Promise.all([
          requestBlockOf(contract, provider, requestTx).then((n) => provider.getBlock(n).then((b) => ({ n, b }))),
          ordinalOf(contract, parentId, childId),
        ])
      : Promise.resolve(null),
  ]);
  say("read its parent, its attested score and its seed's block");

  const parentGenome = genomeForRoot(parent.genomeRoot);
  if (!parentGenome) throw new Error("the parent's root resolves to no configuration in the gene space");
  const derived = mutate(parentGenome, child.mutationSeed);
  const derivedRoot = genomeRoot(derived);
  const heredity = derivedRoot === child.genomeRoot;
  say("re-ran the mutation: " + (heredity ? "same child" : "a different child"));

  let seed = { checked: false };
  if (seedInputs) {
    const [{ n: requestBlock, b: block }, ordinal] = seedInputs;
    if (!block) throw new Error("block " + requestBlock + " is no longer served by this RPC");
    const recomputed = ethers.solidityPackedKeccak256(
      ["bytes32", "bytes32", "uint256", "uint32"],
      [parent.genomeRoot, block.hash, parentId, ordinal]
    );
    seed = { checked: true, requestBlock, blockHash: block.hash, ordinal, recomputed, holds: recomputed === child.mutationSeed };
    say("recomputed the seed from block " + requestBlock + ": " + (seed.holds ? "matches" : "does not match"));
  }

  let score = { attested: false };
  if (fitness.attestedAt !== 0n) {
    const onChainGenome = genomeForRoot(child.genomeRoot);
    if (!onChainGenome) {
      score = { attested: true, checked: false, attestedBps: Number(fitness.score) };
    } else {
      const measured = evaluate(onChainGenome);
      score = {
        attested: true,
        checked: true,
        attestedBps: Number(fitness.score),
        measuredBps: measured.fitnessBps,
        holds: BigInt(measured.fitnessBps) === fitness.score,
        evidenceHolds: measured.evidenceRoot === fitness.evidenceRoot,
      };
      say("re-measured the score: " + measured.fitnessBps + " bps against " + fitness.score + " attested");
    }
  }

  const failed = [];
  if (!heredity) failed.push("heredity");
  if (seed.checked && !seed.holds) failed.push("seed");
  if (score.checked && !score.holds) failed.push("score");
  if (score.checked && !score.evidenceHolds) failed.push("evidence");

  return {
    childId,
    parentId,
    parentLabel: phenotype(parentGenome),
    derivedLabel: phenotype(derived),
    recordedLabel: genomeForRoot(child.genomeRoot) ? phenotype(genomeForRoot(child.genomeRoot)) : null,
    derivedRoot,
    onChainRoot: child.genomeRoot,
    mutationSeed: child.mutationSeed,
    heredity,
    seed,
    score,
    failed,
    verdict: failed.length === 0 ? "GENUINE" : "FORGED",
  };
}

module.exports = { checkLive };
