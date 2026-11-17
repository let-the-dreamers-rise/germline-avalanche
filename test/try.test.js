"use strict";

// scripts/try.js is what an outside developer runs first, so it gets the
// same treatment as the lifecycle scripts: run it for real against an
// in-process chain and check that what it reports is what the chain holds.

const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const os = require("os");
const path = require("path");

const { tryIt, verifyRun, loadTrial } = require("../scripts/try");
const wallet = require("../scripts/wallet");

const noop = () => {};

describe("try.js", function () {
  this.timeout(120000);

  let tmpDir, saved;

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "germline-try-"));
    saved = {
      GERMLINE_DEPLOYMENTS: process.env.GERMLINE_DEPLOYMENTS,
      TRY_CONTRACT: process.env.TRY_CONTRACT,
      TRIAL: process.env.TRIAL,
    };
    process.env.GERMLINE_DEPLOYMENTS = tmpDir;
    delete process.env.TRY_CONTRACT;
    delete process.env.TRIAL;
  });

  afterEach(function () {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("deploys a registry the caller curates, records a search, and verifies all of it", async function () {
    const receipt = await tryIt({ log: noop, generations: 3 });
    const [me] = await ethers.getSigners();

    const germline = await ethers.getContractAt("Germline", receipt.registry);
    expect(await germline.curator()).to.equal(me.address);
    // The founder's own score is the bar, so the founder can breed.
    expect(Number(await germline.survivalThreshold())).to.equal(receipt.founder.fitnessBps);

    expect(receipt.organisms.length).to.be.greaterThan(1);
    expect(Number(await germline.population())).to.equal(receipt.organisms.length);
    for (const organism of receipt.organisms) {
      expect(organism.verdict).to.equal("GENUINE");
      if (organism.parent) expect(organism.heredity).to.equal(true);
    }
    expect(receipt.best.fitnessBps).to.be.at.least(receipt.founder.fitnessBps);

    const file = path.join(tmpDir, "hardhat-try-" + me.address.slice(2, 8).toLowerCase() + ".local.json");
    expect(fs.existsSync(file)).to.equal(true);
  });

  it("runs a different trial named by TRIAL", async function () {
    process.env.TRIAL = path.join(__dirname, "..", "examples", "pricing-rules.js");
    const receipt = await tryIt({ log: noop, generations: 1 });
    expect(receipt.trial).to.equal("checkout-discount-ladder");
    expect(receipt.organisms.every((o) => o.verdict === "GENUINE")).to.equal(true);
  });

  it("says FORGED when a configuration is not the one its seed produces", async function () {
    const { trial } = loadTrial(path.join(__dirname, "..", "examples", "prompt-config.js"));
    const receipt = await tryIt({ log: noop, generations: 2, trial });
    const germline = await ethers.getContractAt("Germline", receipt.registry);

    // Rebuild the run's population from the receipt, then swap one child's
    // configuration for a different, valid one: exactly what a breeder who
    // revealed a configuration they preferred would be claiming.
    const population = receipt.organisms.map((o, i) => ({
      id: i + 1,
      onChainId: o.id,
      parent: o.parent,
      label: o.label,
      fitnessBps: o.fitnessBps,
      config: null,
    }));
    // Configurations are not in the receipt's organism list, so recover them
    // the way a verifier would: from the gene space, by root.
    const roots = new Map();
    const space = enumerate(trial);
    for (const config of space) roots.set(trial.root(config).toLowerCase(), config);
    for (const member of population) {
      const organism = await germline.organismOf(member.onChainId);
      member.config = roots.get(String(organism.genomeRoot).toLowerCase());
      expect(member.config, "every root should be in the gene space").to.not.equal(undefined);
    }
    const honest = await verifyRun(trial, germline, population);
    expect(honest.every((r) => r.verdict === "GENUINE")).to.equal(true);

    const child = population.find((m) => m.parent);
    const other = space.find((c) => trial.root(c) !== trial.root(child.config));
    child.config = other;
    const forged = await verifyRun(trial, germline, population);
    const caught = forged.find((r) => r.id === child.onChainId);
    expect(caught.verdict).to.equal("FORGED");
  });

  it("refuses to found a lineage in a registry this wallet does not curate", async function () {
    const [, stranger] = await ethers.getSigners();
    const Germline = await ethers.getContractFactory("Germline", stranger);
    const theirs = await Germline.deploy(1000, 500, 2);
    await theirs.waitForDeployment();
    process.env.TRY_CONTRACT = await theirs.getAddress();
    let caught = null;
    try {
      await tryIt({ log: noop, generations: 1 });
    } catch (error) {
      caught = error;
    }
    expect(caught).to.not.equal(null);
    expect(caught.message).to.match(/is curated by/);
  });

  it("reuses a registry this wallet already curates", async function () {
    const first = await tryIt({ log: noop, generations: 1 });
    process.env.TRY_CONTRACT = first.registry;
    const { trial } = loadTrial(path.join(__dirname, "..", "examples", "pricing-rules.js"));
    const second = await tryIt({ log: noop, generations: 1, trial });
    expect(second.registry).to.equal(first.registry);
    expect(second.deployTx).to.equal(null);
    const germline = await ethers.getContractAt("Germline", first.registry);
    expect(Number(await germline.population())).to.equal(first.organisms.length + second.organisms.length);
  });

  it("npm run wallet writes a key once and never overwrites one", function () {
    const file = path.join(tmpDir, ".env");
    fs.writeFileSync(file, "TRIAL=examples/pricing-rules.js");
    const first = wallet.main({ log: noop, file });
    const text = fs.readFileSync(file, "utf8");
    expect(text).to.match(/^TRIAL=examples\/pricing-rules.js\n/);
    const key = wallet.existingKey(text);
    expect(new ethers.Wallet(key).address).to.equal(first);
    const second = wallet.main({ log: noop, file });
    expect(second).to.equal(first);
    expect(fs.readFileSync(file, "utf8")).to.equal(text);
  });
});

// Every configuration a trial's genes allow, small enough to list for the
// example trials. A verifier with only roots and the trial can do the same.
function enumerate(trial) {
  const schema = trial.genes || trial.schema;
  const keys = schema.map((g) => g.key);
  const values = schema.map((g) => {
    if (g.type === "bool") return [false, true];
    if (g.type === "int") {
      const out = [];
      for (let v = g.min; v <= g.max; v++) out.push(v);
      return out;
    }
    if (g.type === "choice") return g.options.slice();
    throw new Error("enumerate: unsupported gene type " + g.type);
  });
  const out = [];
  const walk = (i, acc) => {
    if (i === keys.length) return out.push({ ...acc });
    for (const v of values[i]) {
      acc[keys[i]] = v;
      walk(i + 1, acc);
    }
  };
  walk(0, {});
  return out;
}
