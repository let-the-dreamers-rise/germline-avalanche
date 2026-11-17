"use strict";

// Put every payload behind a live lineage at a public URL.
//
// The chain records two roots per organism: the genome it carries and the
// evidence (the fitness transcript) its score was attested from. Neither
// payload is on chain, so a stranger who wants to look inside a lineage needs
// somewhere to fetch the bytes. lib/store.js already reads from any plain
// HTTP host and refuses bytes that do not hash to the root they were asked
// for, so the host does not have to be trusted. The site is such a host.
//
// This reads the population from the chain, finds the bytes for every root,
// checks each one hashes to its root, and copies it to web/blobs/<root>.json,
// which Vercel serves at https://germline-avalanche.vercel.app/blobs/<root>.json.
// It also writes web/blobs/index.json: which organism on which network each
// root belongs to.
//
// Where the bytes come from, in order: the payload store (blobs/), the genome
// cache (genomes/), and, failing both, the engine itself. A genome can be
// re-derived from its parent and the on-chain seed, and a transcript can be
// re-measured from its genome. Either is kept only if it hashes to the root
// the chain recorded, so a re-derived payload is exactly as good as a stored
// one -- and a forged child, which no derivation produces, has to come from a
// store or it is reported missing.
//
// Run:  npx hardhat run scripts/publish-payloads.js --network avalanche
//       npx hardhat run scripts/publish-payloads.js --network fuji

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { canonical, genomeRoot } = require("../engine/genome");
const { mutate } = require("../engine/mutate");
const { evaluate } = require("../engine/fitness");
const genomes = require("../lib/genomes");
const store = require("../lib/store");
const census = require("../lib/census");
const { loadDeployment, assertChainMatches } = require("../lib/chain");

const ZERO = "0x" + "0".repeat(64);
const PUBLIC_BASE = "https://germline-avalanche.vercel.app/blobs";

function outDir() {
  return process.env.GERMLINE_PUBLIC_BLOBS || path.join(__dirname, "..", "web", "blobs");
}

async function storedBytes(root) {
  try {
    const bytes = await store.fetchByRoot(root);
    if (bytes !== null && bytes !== undefined) return String(bytes);
  } catch (error) {
    // A store copy that fails its hash is not one we can publish; fall through.
  }
  return null;
}

function cachedGenome(root) {
  if (!genomes.has(root)) return null;
  try {
    return genomes.get(root);
  } catch (error) {
    return null;
  }
}

async function genomeBytes(row, byId) {
  const stored = await storedBytes(row.genomeRoot);
  if (stored) return { bytes: stored, source: "store" };
  const cached = cachedGenome(row.genomeRoot);
  if (cached) return { bytes: canonical(cached), source: "genome cache", genome: cached };
  const parent = byId.get(row.parent);
  if (parent && parent.genome && row.mutationSeed && row.mutationSeed !== ZERO) {
    const child = mutate(parent.genome, row.mutationSeed);
    if (genomeRoot(child) === row.genomeRoot.toLowerCase()) {
      return { bytes: canonical(child), source: "re-derived from parent and seed", genome: child };
    }
  }
  return null;
}

async function evidenceBytes(row, genome) {
  const stored = await storedBytes(row.evidenceRoot);
  if (stored) return { bytes: stored, source: "store" };
  if (genome) {
    const measured = evaluate(genome);
    if (measured.evidenceRoot.toLowerCase() === row.evidenceRoot.toLowerCase()) {
      return { bytes: JSON.stringify(measured.transcript), source: "re-measured from genome" };
    }
  }
  return null;
}

function parseGenome(bytes) {
  try {
    return JSON.parse(bytes);
  } catch (error) {
    return null;
  }
}

function writePayload(dir, root, bytes) {
  // Never trust the source: the file must be the pre-image of its own name.
  store.verify(root, bytes);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, root.toLowerCase() + ".json"), bytes, "utf8");
}

function loadIndex(file) {
  if (!fs.existsSync(file)) return { base: PUBLIC_BASE, payloads: [] };
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function publishPayloads(options = {}) {
  const log = options.log || console.log;
  const network = hre.network.name;
  const record = loadDeployment(hre);
  await assertChainMatches(hre, record);
  const germline = await hre.ethers.getContractAt("Germline", record.address);
  const rows = await census.readPopulation(germline);
  const dir = options.outDir || outDir();

  log("network:   " + network);
  log("contract:  " + record.address);
  log("organisms: " + rows.length);
  log("");

  const byId = new Map();
  const entries = [];
  const missing = [];
  for (const row of rows) {
    const g = await genomeBytes(row, byId);
    const genome = g ? g.genome || parseGenome(g.bytes) : null;
    byId.set(row.id, { genome });
    if (g) {
      writePayload(dir, row.genomeRoot, g.bytes);
      entries.push({ network, chainId: record.chainId, contract: record.address, organism: row.id, kind: "genome", root: row.genomeRoot.toLowerCase() });
      log("#" + row.id + " genome    " + row.genomeRoot + "  (" + g.source + ")");
    } else {
      missing.push("#" + row.id + " genome " + row.genomeRoot);
      log("#" + row.id + " genome    " + row.genomeRoot + "  MISSING");
    }

    if (!row.attested || !row.evidenceRoot || row.evidenceRoot === ZERO) continue;
    const e = await evidenceBytes(row, genome);
    if (e) {
      writePayload(dir, row.evidenceRoot, e.bytes);
      entries.push({ network, chainId: record.chainId, contract: record.address, organism: row.id, kind: "evidence", root: row.evidenceRoot.toLowerCase() });
      log("#" + row.id + " evidence  " + row.evidenceRoot + "  (" + e.source + ")");
    } else {
      missing.push("#" + row.id + " evidence " + row.evidenceRoot);
      log("#" + row.id + " evidence  " + row.evidenceRoot + "  MISSING");
    }
  }

  // One index for every network: replace this network's rows, keep the rest.
  const indexFile = path.join(dir, "index.json");
  const index = loadIndex(indexFile);
  index.base = PUBLIC_BASE;
  index.payloads = index.payloads
    .filter((p) => !(p.network === network && p.contract.toLowerCase() === record.address.toLowerCase()))
    .concat(entries);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2) + "\n");

  log("");
  log(entries.length + " payloads written to " + dir);
  if (missing.length) {
    throw new Error("no verified bytes for " + missing.length + " root(s): " + missing.join("; "));
  }
  return { entries, dir };
}

if (require.main === module) {
  publishPayloads().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { publishPayloads, PUBLIC_BASE };
