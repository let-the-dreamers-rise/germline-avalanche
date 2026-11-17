"use strict";

// npm run agent: one command, one JSON object, no chain.

const { expect } = require("chai");
const path = require("path");
const { execFileSync } = require("child_process");
const { agent } = require("../scripts/agent");

const ROOT = path.join(__dirname, "..");

describe("agent.js", function () {
  this.timeout(30000);

  it("tunes the example and returns the lineage from the starting config to the best", async function () {
    const result = await agent({ trialFile: path.join(ROOT, "examples", "prompt-config.js"), budget: 30, salt: "agent-test" });
    expect(result.ok).to.equal(true);
    expect(result.best.score).to.be.at.least(result.start.score);
    expect(result.improvement).to.equal(result.best.score - result.start.score);
    expect(["search", "random", "tied"]).to.include(result.verdict.winner);
    const lineage = result.lineage;
    expect(lineage[0].parent).to.equal(null);
    expect(lineage[0].score).to.equal(result.start.score);
    expect(lineage[lineage.length - 1].root).to.equal(result.best.root);
    for (let i = 1; i < lineage.length; i++) expect(lineage[i].parent).to.equal(lineage[i - 1].id);
  });

  it("prints only JSON on stdout, and JSON with ok:false and a non-zero exit on a bad trial", function () {
    const out = execFileSync("node", [path.join(ROOT, "scripts", "agent.js")], { cwd: ROOT, env: { ...process.env, BUDGET: "12" } }).toString();
    const parsed = JSON.parse(out);
    expect(parsed.ok).to.equal(true);
    expect(parsed.ms).to.be.below(5000);

    let failed = null;
    try {
      execFileSync("node", [path.join(ROOT, "scripts", "agent.js"), "no/such/trial.js"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      failed = error;
    }
    expect(failed && failed.status).to.equal(1);
    const body = JSON.parse(failed.stdout.toString());
    expect(body.ok).to.equal(false);
    expect(body.error).to.match(/does not exist/);
  });
});
