"use strict";

// The store is the one component that is allowed to be untrusted, so these
// tests are mostly about what it refuses. A store that returns the wrong
// bytes is not a bug to be logged -- it is the exact attack the root exists
// to defeat, and the only acceptable behaviour is a hard failure.

const { expect } = require("chai");
const fs = require("fs");
const os = require("os");
const path = require("path");

const store = require("../lib/store");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "germline-store-"));
}

describe("content-addressed store", function () {
  let dir;
  let previousBackend;
  let previousDir;

  beforeEach(function () {
    previousBackend = process.env.GERMLINE_STORE;
    previousDir = process.env.GERMLINE_STORE_DIR;
    dir = tempDir();
    process.env.GERMLINE_STORE = "fs";
    process.env.GERMLINE_STORE_DIR = dir;
  });

  afterEach(function () {
    if (previousBackend === undefined) delete process.env.GERMLINE_STORE;
    else process.env.GERMLINE_STORE = previousBackend;
    if (previousDir === undefined) delete process.env.GERMLINE_STORE_DIR;
    else process.env.GERMLINE_STORE_DIR = previousDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a payload under its own root", async function () {
    const bytes = JSON.stringify({ version: 1, retrievalDepth: 7 });
    const written = await store.publish(bytes);

    expect(written.root).to.equal(store.rootOf(bytes));
    expect(written.backend).to.equal("fs");

    const read = await store.fetchByRoot(written.root);
    expect(read).to.equal(bytes);
  });

  it("returns null for a root it does not hold, rather than throwing", async function () {
    const absent = "0x" + "1".repeat(64);
    expect(await store.fetchByRoot(absent)).to.equal(null);
  });

  it("refuses bytes that do not hash to the root they were filed under", async function () {
    const bytes = JSON.stringify({ version: 1, retrievalDepth: 7 });
    const { root } = await store.publish(bytes);

    // Exactly what a hostile or careless host does: same name, other content.
    fs.writeFileSync(
      path.join(dir, root + ".json"),
      JSON.stringify({ version: 1, retrievalDepth: 99 }),
      "utf8"
    );

    let raised = null;
    try {
      await store.fetchByRoot(root);
    } catch (error) {
      raised = error;
    }
    expect(raised, "tampered bytes must not be returned").to.not.equal(null);
    expect(raised.message).to.contain("not to the root");
  });

  it("refuses to file a payload under a root that is not its hash", async function () {
    const bytes = JSON.stringify({ version: 1 });
    const wrong = "0x" + "2".repeat(64);

    let raised = null;
    try {
      await store.publish(bytes, { root: wrong });
    } catch (error) {
      raised = error;
    }
    expect(raised).to.not.equal(null);
    expect(raised.message).to.contain("refusing to store");
  });

  it("rejects a malformed root instead of guessing", async function () {
    let raised = null;
    try {
      await store.fetchByRoot("not-a-root");
    } catch (error) {
      raised = error;
    }
    expect(raised).to.not.equal(null);
    expect(raised.message).to.contain("32 bytes of hex");
  });

  it("names an unknown backend rather than falling back silently", async function () {
    process.env.GERMLINE_STORE = "dropbox";
    let raised = null;
    try {
      await store.publish("{}");
    } catch (error) {
      raised = error;
    }
    expect(raised).to.not.equal(null);
    expect(raised.message).to.contain("dropbox");
  });

  it("reports a writable directory as reachable", async function () {
    const health = await store.reachable();
    expect(health.reachable).to.equal(true);
    expect(health.backend).to.equal("fs");
  });

  it("agrees with the roots the rest of the project computes", function () {
    const { hashText } = require("../sdk/canonical");
    const bytes = JSON.stringify({ version: 1, rerank: true });
    expect(store.rootOf(bytes)).to.equal(hashText(bytes));
  });
});
