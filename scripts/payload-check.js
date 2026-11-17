"use strict";

// Fetch every published payload and check it against its root. No chain, no
// key: it reads web/blobs/index.json (or the live one) and asks lib/store.js
// for each root, which refuses any bytes that do not hash to it.
//
// Against the public site:
//   GERMLINE_STORE=http GERMLINE_STORE_URL=https://germline-avalanche.vercel.app/blobs npm run check:payloads
// Against the files in this checkout:
//   GERMLINE_STORE_DIR=web/blobs npm run check:payloads

const fs = require("fs");
const path = require("path");
const store = require("../lib/store");

async function loadIndex() {
  if (store.backendName() === "http") {
    const base = String(process.env.GERMLINE_STORE_URL || "").replace(/\/+$/, "");
    const response = await fetch(base + "/index.json");
    if (!response.ok) throw new Error("no index.json at " + base + " (HTTP " + response.status + ")");
    return response.json();
  }
  const file = path.join(store.storeDir(), "index.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function payloadCheck(options = {}) {
  const log = options.log || console.log;
  const index = options.index || (await loadIndex());
  let ok = 0;
  const bad = [];
  for (const entry of index.payloads) {
    const label = entry.network + " #" + entry.organism + " " + entry.kind + " " + entry.root;
    try {
      const bytes = await store.fetchByRoot(entry.root);
      if (bytes === null) {
        bad.push(label + ": not found");
        log("MISSING   " + label);
      } else {
        ok++;
        log("verified  " + label);
      }
    } catch (error) {
      bad.push(label + ": " + error.message);
      log("REFUSED   " + label);
    }
  }
  log("");
  log(ok + " of " + index.payloads.length + " payloads fetched and verified against their roots");
  if (bad.length) throw new Error(bad.length + " payload(s) failed: " + bad.join("; "));
  return { ok, total: index.payloads.length };
}

if (require.main === module) {
  payloadCheck().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = { payloadCheck };
