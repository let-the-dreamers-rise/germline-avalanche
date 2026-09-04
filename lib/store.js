"use strict";

// Where payloads live when the chain is not 0G.
//
// The chain stores a 32-byte root; the genome and the fitness transcript it
// names have to live somewhere a verifier can fetch them. On 0G that place is
// 0G Storage, and lib/storage.js talks to it. Avalanche has no equivalent, and
// the temptation is to find one -- some other network-flavoured blob service
// to depend on instead.
//
// That would be the wrong instinct, because of a property this project
// already has: a root is keccak256 over canonical bytes (sdk/canonical.js),
// computed by us, from bytes we hold. So a reader can check what they were
// handed. The store does not need to be trusted, or decentralised, or even
// well-behaved -- it needs to return the bytes, and if it returns different
// ones the hash says so and we refuse them.
//
// Which means the honest answer for Avalanche is not another dependency. It is
// no dependency: any dumb file directory or HTTP host works, and correctness
// comes from the hash rather than from the host. lib/genomes.js already proved
// the shape locally; this generalises it and lets the bytes live off the
// machine that made them.
//
//   GERMLINE_STORE=fs     write files under GERMLINE_STORE_DIR (default)
//   GERMLINE_STORE=http   read from GERMLINE_STORE_URL, write if PUT is set
//   GERMLINE_STORE=0g     delegate to lib/storage.js, unchanged
//
// Every read verifies. There is no flag to turn that off, because a store
// whose contents are not checked is a store you are trusting, and the entire
// point of the root is that you do not have to.

const fs = require("fs");
const path = require("path");
const { keccak256, toUtf8Bytes } = require("ethers");

const TIMEOUT_MS = Number(process.env.GERMLINE_STORE_TIMEOUT_MS || 10000);

function backendName() {
  return (process.env.GERMLINE_STORE || "fs").trim().toLowerCase();
}

function storeDir() {
  return process.env.GERMLINE_STORE_DIR || path.join(__dirname, "..", "blobs");
}

/// The root of a payload: keccak256 over its exact bytes. Deliberately the
/// same function the rest of the project uses, so a payload's name here and
/// its name on chain cannot drift apart.
function rootOf(bytes) {
  if (typeof bytes !== "string") {
    throw new TypeError("a payload must be the exact string that was hashed");
  }
  return keccak256(toUtf8Bytes(bytes));
}

function normalise(root) {
  if (typeof root !== "string") {
    throw new TypeError("a root must be a hex string, got " + typeof root);
  }
  const lower = root.toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(lower)) {
    throw new Error("a root must be 32 bytes of hex, got: " + root);
  }
  return lower;
}

/// Refuse bytes that are not the ones asked for. This is the whole security
/// argument for using an untrusted host, so it is a hard failure and never a
/// warning: a caller that carried on with unverified bytes would be trusting
/// the host, which is exactly what the root exists to avoid.
function verify(root, bytes) {
  const wanted = normalise(root);
  const actual = rootOf(bytes);
  if (actual !== wanted) {
    throw new Error(
      "the store returned bytes that hash to " +
        actual +
        ", not to the root they were requested under (" +
        wanted +
        "). These are not the payload the chain recorded, so they are refused."
    );
  }
  return bytes;
}

// ----------------------------------------------------------------- fs

function fsPathFor(root) {
  return path.join(storeDir(), normalise(root) + ".json");
}

async function fsPublish(bytes, root) {
  const file = fsPathFor(root);
  fs.mkdirSync(storeDir(), { recursive: true });
  // No trailing newline. The file is the pre-image of its own name and a
  // stray byte would break that, which is the failure genomes.js documents.
  fs.writeFileSync(file, bytes, "utf8");
  return { uri: "file://" + file.split(path.sep).join("/") };
}

async function fsFetch(root) {
  const file = fsPathFor(root);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, "utf8");
}

// --------------------------------------------------------------- http

function httpBase() {
  const url = process.env.GERMLINE_STORE_URL;
  if (!url) {
    throw new Error(
      "GERMLINE_STORE=http needs GERMLINE_STORE_URL, the base a payload is " +
        "fetched from as <base>/<root>.json"
    );
  }
  return url.replace(/\/+$/, "");
}

async function withTimeout(run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function httpPublish(bytes, root) {
  // Reading from a static host is the common case and needs no upload path at
  // all -- the operator copies the blobs directory to wherever they serve it.
  // A PUT endpoint is supported when one exists, and its absence is reported
  // rather than treated as a failure.
  const put = process.env.GERMLINE_STORE_PUT_URL;
  if (!put) {
    return {
      uri: httpBase() + "/" + normalise(root) + ".json",
      note:
        "no GERMLINE_STORE_PUT_URL, so nothing was uploaded; the URI is where " +
        "this payload is expected once the blobs directory is served",
      uploaded: false,
    };
  }
  const target = put.replace(/\/+$/, "") + "/" + normalise(root) + ".json";
  const response = await withTimeout((signal) =>
    fetch(target, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: bytes,
      signal,
    })
  );
  if (!response.ok) {
    throw new Error("store PUT " + target + " returned " + response.status);
  }
  return { uri: httpBase() + "/" + normalise(root) + ".json", uploaded: true };
}

async function httpFetch(root) {
  const target = httpBase() + "/" + normalise(root) + ".json";
  const response = await withTimeout((signal) => fetch(target, { signal }));
  if (!response.ok) return null;
  return await response.text();
}

// ----------------------------------------------------------------- 0g

function zerog() {
  return require("./storage");
}

// ------------------------------------------------------------- surface

/// Store one payload under its own root. `bytes` must be the exact
/// serialisation the root is the hash of; we recompute it here rather than
/// taking the caller's word, because a root that does not match its payload
/// is a lineage nobody can check later.
async function publish(bytes, meta = {}) {
  const root = rootOf(bytes);
  if (meta.root && normalise(meta.root) !== root) {
    throw new Error(
      "refusing to store a payload under " +
        meta.root +
        " when its bytes hash to " +
        root
    );
  }

  const backend = backendName();
  if (backend === "fs") return { root, backend, ...(await fsPublish(bytes, root)) };
  if (backend === "http") return { root, backend, ...(await httpPublish(bytes, root)) };
  if (backend === "0g" || backend === "zerog") {
    const result = await zerog().publish(bytes, { ...meta, root });
    return { root, backend: "0g", ...(result || {}) };
  }
  throw new Error(
    "unknown GERMLINE_STORE '" + backend + "'; expected fs, http or 0g"
  );
}

/// Fetch the payload behind a root, or null if this store does not have it.
/// Bytes that come back are verified before they are returned.
async function fetchByRoot(root) {
  const wanted = normalise(root);
  const backend = backendName();

  let bytes = null;
  if (backend === "fs") bytes = await fsFetch(wanted);
  else if (backend === "http") bytes = await httpFetch(wanted);
  else if (backend === "0g" || backend === "zerog") bytes = await zerog().fetchByRoot(wanted);
  else throw new Error("unknown GERMLINE_STORE '" + backend + "'");

  if (bytes === null || bytes === undefined) return null;
  return verify(wanted, bytes);
}

/// Whether this store can be reached at all, in the shape storage-check.js
/// already prints. Never throws: an unreachable store is a fact to report,
/// not a crash.
async function reachable() {
  const backend = backendName();
  try {
    if (backend === "fs") {
      const where = storeDir();
      fs.mkdirSync(where, { recursive: true });
      fs.accessSync(where, fs.constants.W_OK);
      return { reachable: true, backend, where };
    }
    if (backend === "http") {
      const absent = "0x" + "0".repeat(64);
      const target = httpBase() + "/" + absent + ".json";
      const response = await withTimeout((signal) => fetch(target, { signal }));
      // A 404 for a root nobody stored is the healthy answer.
      return {
        reachable: response.status === 404 || response.ok,
        backend,
        where: httpBase(),
        status: response.status,
      };
    }
    const health = await zerog().gatewayReachable();
    return { ...health, backend: "0g" };
  } catch (error) {
    return { reachable: false, backend, error: error.message.slice(0, 160) };
  }
}

module.exports = { publish, fetchByRoot, reachable, rootOf, verify, backendName, storeDir };
