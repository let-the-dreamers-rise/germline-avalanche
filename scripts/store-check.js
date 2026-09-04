"use strict";

// Prove the store works, end to end, before a lineage depends on it.
//
// Writes a payload, reads it back, then corrupts it and confirms the read is
// refused. The last step is the one worth watching: it is the difference
// between a store you trust and a store you check.
//
//   node scripts/store-check.js
//   GERMLINE_STORE=http GERMLINE_STORE_URL=https://blobs.example.com node scripts/store-check.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const store = require("../lib/store");

async function main() {
  const backend = store.backendName();
  const health = await store.reachable();

  console.log("backend    " + backend);
  console.log("reachable  " + health.reachable + (health.where ? "  " + health.where : ""));
  if (health.error) console.log("error      " + health.error);
  if (!health.reachable) {
    console.log("\nThe store cannot be reached. Publishing is best effort, so this does");
    console.log("not stop reproduction -- roots still land on chain -- but nobody will");
    console.log("be able to fetch the payloads behind them.");
    process.exitCode = 1;
    return;
  }

  const payload = JSON.stringify({ version: 1, check: "store-check", at: Date.now() });
  const written = await store.publish(payload);
  console.log("\nwrote      " + written.root);
  if (written.uri) console.log("uri        " + written.uri);
  if (written.note) console.log("note       " + written.note);

  const read = await store.fetchByRoot(written.root);
  if (read === null) {
    console.log("\nread back  MISSING -- the store accepted the write and cannot serve it");
    process.exitCode = 1;
    return;
  }
  console.log("read back  ok, " + read.length + " bytes, hash verified");

  // The tamper check only makes sense where this process can reach the bytes,
  // which is the fs backend. Elsewhere, say so rather than pretend.
  if (backend !== "fs") {
    console.log("\ntamper     skipped (only the fs backend can corrupt its own bytes here)");
    console.log("\nStore is working.");
    return;
  }

  const file = path.join(store.storeDir(), written.root + ".json");
  const original = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, JSON.stringify({ version: 1, check: "tampered" }), "utf8");
  let refused = false;
  try {
    await store.fetchByRoot(written.root);
  } catch (error) {
    refused = true;
    console.log("tamper     refused, as it must be");
  } finally {
    fs.writeFileSync(file, original, "utf8");
  }
  if (!refused) {
    console.log("tamper     ACCEPTED -- this is a defect; the store is not verifying reads");
    process.exitCode = 1;
    return;
  }

  console.log("\nStore is working, and it checks what it is handed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
