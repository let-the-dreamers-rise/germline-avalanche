"use strict";

// End-to-end exercise of the on-chain lifecycle scripts against an
// in-process chain: found the FOUNDER, breed one honest child, verify it,
// and -- the case that actually matters -- confirm that a forged child is
// caught rather than waved through.
//
// The scripts under test read their contract address from
// deployments/<network>.json and cache genomes under genomes/<root>.json.
// Both locations are overridable (GERMLINE_DEPLOYMENTS, GERMLINE_GENOMES)
// for exactly this reason: a test run must not read or write the real
// project state.

const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;
const { mine } = require("@nomicfoundation/hardhat-network-helpers");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { FOUNDER, genomeRoot } = require("../engine/genome");
const { evaluate } = require("../engine/fitness");
const { eventFrom } = require("../lib/chain");
const { found } = require("../scripts/found");
const { breed } = require("../scripts/breed");
const { verify } = require("../scripts/verify");
const { forge } = require("../scripts/forge");
const { e2e, breedAlive } = require("../scripts/e2e");
const { recheck } = require("../scripts/recheck");
const { checkLive } = require("../sdk/live-check");

const SURVIVAL = 3148; // the measured action-only baseline; see engine/fitness.js
const STEP = 500;
const BASE = 4;

const noop = () => {};

// breed.js polls mutationSeedFor with a real setTimeout delay until the
// commitment's block is mined. Hardhat Network only advances a block for a
// transaction, so left alone the poll loop would spin until it gave up --
// something has to mine while it waits, the way a live chain ticks forward
// on its own. This runs a background miner alongside the given promise and
// stops it once that promise settles, either way.
async function withBlockPump(promise) {
  let stop = false;
  const pump = (async () => {
    while (!stop) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (stop) break;
      try {
        await mine(1);
      } catch (error) {
        // The network can be mid-teardown by the time a trailing tick
        // fires; that is not a failure of the promise being pumped.
      }
    }
  })();
  try {
    return await promise;
  } finally {
    stop = true;
    await pump;
  }
}

describe("lifecycle scripts", function () {
  this.timeout(60000);

  let tmpDir, deploymentsDir, genomesDir, originalEnv;

  beforeEach(async function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "germline-lifecycle-"));
    deploymentsDir = path.join(tmpDir, "deployments");
    genomesDir = path.join(tmpDir, "genomes");

    originalEnv = {
      GERMLINE_DEPLOYMENTS: process.env.GERMLINE_DEPLOYMENTS,
      GERMLINE_GENOMES: process.env.GERMLINE_GENOMES,
      GERMLINE_POLL_MS: process.env.GERMLINE_POLL_MS,
      GERMLINE_SEED_TRIES: process.env.GERMLINE_SEED_TRIES,
      CONTRACT: process.env.CONTRACT,
      CHILD_ID: process.env.CHILD_ID,
      PARENT_ID: process.env.PARENT_ID,
    };
    process.env.GERMLINE_DEPLOYMENTS = deploymentsDir;
    process.env.GERMLINE_GENOMES = genomesDir;
    process.env.GERMLINE_POLL_MS = "30";
    process.env.GERMLINE_SEED_TRIES = "80";
    delete process.env.CONTRACT;
    delete process.env.CHILD_ID;
    delete process.env.PARENT_ID;

    const Germline = await ethers.getContractFactory("Germline");
    const germline = await Germline.deploy(SURVIVAL, STEP, BASE);
    await germline.waitForDeployment();
    const address = await germline.getAddress();
    const network = await ethers.provider.getNetwork();
    const [deployer] = await ethers.getSigners();

    fs.mkdirSync(deploymentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(deploymentsDir, hre.network.name + ".json"),
      JSON.stringify(
        {
          network: hre.network.name,
          chainId: Number(network.chainId),
          address,
          deployTx: germline.deploymentTransaction().hash,
          deployer: deployer.address,
          survivalThreshold: SURVIVAL,
          fecundityStep: STEP,
          baseFecundity: BASE,
          deployedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );

    this.germline = germline;
    this.address = address;
  });

  afterEach(function () {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("founds the FOUNDER genome at the measured baseline score", async function () {
    const result = await found({ log: noop });

    expect(result.id).to.equal(1);
    expect(result.genomeRoot).to.equal(genomeRoot(FOUNDER));
    expect(result.fitnessBps).to.equal(SURVIVAL);
    expect(result.allowance).to.equal(BASE);

    const onChain = await this.germline.organismOf(1);
    expect(onChain.genomeRoot).to.equal(genomeRoot(FOUNDER));
    const fitness = await this.germline.fitnessOf(1);
    expect(Number(fitness.score)).to.equal(SURVIVAL);
  });

  it("breeds one honest child that verify.js accepts as genuine", async function () {
    const founded = await found({ log: noop });
    expect(founded.id).to.equal(1);

    // About 8.5% of seeds mutate the founder into itself: flipping ringSides
    // while useRing is false is undone by the coherence rule, and breed()
    // correctly refuses to mint a duplicate. That is a real limitation of the
    // frozen mutation function (see engine/mutate.js), not of this test, and
    // the operator's remedy is the same as ours: the commitment is spent, the
    // next block fixes a fresh seed, try again. A stillbirth mints nothing,
    // so the first live child is still #2.
    let bred;
    for (let attempt = 1; ; attempt++) {
      try {
        bred = await withBlockPump(breed({ log: noop }));
        break;
      } catch (error) {
        if (!/stillborn/.test(String(error.message)) || attempt >= 8) throw error;
      }
    }
    expect(bred.parentId).to.equal(1);
    expect(bred.childId).to.equal(2);
    expect(bred.recordedSeed.toLowerCase()).to.equal(bred.seed.toLowerCase());

    const onChain = await this.germline.organismOf(2);
    expect(onChain.parent).to.equal(1n);
    expect(onChain.genomeRoot).to.equal(bred.childRoot);

    const result = await verify({ childId: 2, log: noop });
    expect(result.genuine).to.equal(true);
    expect(result.mismatches).to.deep.equal([]);
    expect(result.heredity.holds).to.equal(true);
    expect(result.fitness.scoreHolds).to.equal(true);
    expect(result.fitness.evidenceHolds).to.equal(true);
  });

  it("rejects a forged child whose genome root does not match its recorded seed", async function () {
    await found({ log: noop });
    const germline = this.germline;

    // Commit and reveal exactly like breed.js does, but hand back a genome
    // that is real and honestly measurable -- just not the one the recorded
    // seed derives. spawn() cannot catch this itself: the seed is the
    // contract's, but the revealed root is the breeder's, and only
    // re-running mutate() off chain catches a mismatch between the two.
    await germline.requestSpawn(1);
    await mine(1); // one block is enough to clear TooEarly

    const forgedGenome = {
      ...FOUNDER,
      useColour: true,
      useSize: true,
      useRing: true,
      ringSides: 15,
      useMomentum: true,
      unanimousOnly: true,
      backoff: true,
    };
    const forgedRoot = genomeRoot(forgedGenome);
    expect(await germline.genomeSeen(forgedRoot)).to.equal(false);

    const spawnTx = await germline.spawn(1, forgedRoot);
    const spawnReceipt = await spawnTx.wait();
    const spawned = eventFrom(germline, spawnReceipt, "Spawned");
    const forgedId = Number(spawned.id);
    expect(forgedId).to.equal(2);

    // Attest the forged genome's own true fitness, so the forgery under
    // test is specifically about descent -- this really is a genome in
    // organism 1's reachable space, honestly scored -- and not a second,
    // separate lie about fitness layered on top.
    const measured = evaluate(forgedGenome);
    await germline.attestFitness(
      forgedId,
      measured.fitnessBps,
      measured.trialId,
      measured.evidenceRoot
    );

    let caught = null;
    try {
      await verify({ childId: forgedId, log: noop });
    } catch (error) {
      caught = error;
    }

    expect(caught).to.not.equal(null);
    expect(caught.result.genuine).to.equal(false);
    expect(caught.result.mismatches).to.include("heredity");
    expect(caught.result.heredity.holds).to.equal(false);
    expect(caught.result.heredity.onChainRoot).to.equal(forgedRoot);
    // The seed itself is exactly what the contract computed -- only the
    // revealed root is forged -- so the seed re-derivation still checks out.
    expect(caught.result.seed.holds).to.equal(true);
    // Likewise the fitness figures are honest, so they must still verify:
    // the forgery this test exercises is heredity, and heredity alone.
    expect(caught.result.fitness.scoreHolds).to.equal(true);
    expect(caught.result.fitness.evidenceHolds).to.equal(true);
  });
  it("forge.js mints a forged child and verify.js rejects it", async function () {
    await found({ log: noop });
    const result = await withBlockPump(forge({ parentId: 1, log: noop }));
    expect(result.childId).to.equal(2);
    expect(result.forgedRoot).to.not.equal(result.honestRoot);
    expect(result.verdict.genuine).to.equal(false);
    expect(result.verdict.mismatches).to.include("heredity");
  });

  it("e2e.js runs found, breed, verify and forge, and writes a receipt", async function () {
    const receipt = await withBlockPump(e2e({ log: noop }));
    expect(receipt.honestChild.verdict).to.equal("GENUINE");
    expect(receipt.forgedChild.verdict).to.equal("FORGED");
    expect(receipt.forgedChild.failed).to.include("heredity");
    const file = path.join(deploymentsDir, hre.network.name + "-e2e.json");
    expect(fs.existsSync(file)).to.equal(true);
  });
  it("e2e.js commits again when a seed is stillborn, instead of abandoning the run", async function () {
    const stillborn = () => new Error("stillborn: the seed produced 0x00, a genome that already exists");
    // Two stillbirths, then a live child: the run carries on and returns it.
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls <= 2) throw stillborn();
      return { childId: 2 };
    };
    expect(await breedAlive({}, noop, 5, flaky)).to.deep.equal({ childId: 2 });
    expect(calls).to.equal(3);

    // It gives up after the stated number of commitments rather than looping.
    calls = 0;
    let caught = null;
    try {
      await breedAlive({}, noop, 3, async () => { calls++; throw stillborn(); });
    } catch (error) {
      caught = error;
    }
    expect(calls).to.equal(3);
    expect(String(caught.message)).to.match(/^stillborn/);

    // Any other failure surfaces at once; it is never retried away.
    calls = 0;
    caught = null;
    try {
      await breedAlive({}, noop, 5, async () => { calls++; throw new Error("NotSteward"); });
    } catch (error) {
      caught = error;
    }
    expect(calls).to.equal(1);
    expect(caught.message).to.equal("NotSteward");

    // And against the real chain it lands a real child.
    await found({ log: noop });
    const child = await withBlockPump(breedAlive({ parentId: 1, log: noop }, noop, 8));
    expect(child.childId).to.equal(2);
  });
  it("recheck.js reproduces both recorded verdicts read-only", async function () {
    await withBlockPump(e2e({ log: noop }));
    const before = await ethers.provider.getBlockNumber();
    const result = await recheck({ log: noop });
    expect(result.ok).to.equal(true);
    expect(result.honest.genuine).to.equal(true);
    expect(result.forged.genuine).to.equal(false);
    expect(result.forged.mismatches).to.deep.equal(["heredity"]);
    // Both seeds were re-derived from the chain, not taken on trust.
    expect(result.honest.seed.holds).to.equal(true);
    expect(result.forged.seed.holds).to.equal(true);
    // Read-only means read-only: no transaction, so no new block.
    expect(await ethers.provider.getBlockNumber()).to.equal(before);
  });
  it("checkLive gives the browser the same verdicts from public reads alone", async function () {
    const receipt = await withBlockPump(e2e({ log: noop }));
    // A plain read-only contract, as a web page would build it: no signer.
    const contract = new ethers.Contract(this.address, this.germline.interface, ethers.provider);
    const before = await ethers.provider.getBlockNumber();

    const honest = await checkLive({
      contract,
      provider: ethers.provider,
      childId: receipt.honestChild.id,
      requestTx: receipt.honestChild.requestSpawnTx,
    });
    expect(honest.verdict).to.equal("GENUINE");
    expect(honest.heredity).to.equal(true);
    expect(honest.seed.checked && honest.seed.holds).to.equal(true);
    expect(honest.score.checked && honest.score.holds && honest.score.evidenceHolds).to.equal(true);

    const forged = await checkLive({
      contract,
      provider: ethers.provider,
      childId: receipt.forgedChild.id,
      requestTx: receipt.forgedChild.requestSpawnTx,
    });
    expect(forged.verdict).to.equal("FORGED");
    expect(forged.failed).to.deep.equal(["heredity"]);
    expect(forged.seed.holds).to.equal(true);
    expect(forged.derivedRoot).to.not.equal(forged.onChainRoot);
    expect(await ethers.provider.getBlockNumber()).to.equal(before);
  });
  it("recheck.js fails when a receipt passes a forged child off as honest", async function () {
    const receipt = await withBlockPump(e2e({ log: noop }));
    const swapped = { ...receipt, honestChild: receipt.forgedChild, forgedChild: receipt.honestChild };
    let caught = null;
    try {
      await recheck({ log: noop, receipt: swapped });
    } catch (error) {
      caught = error;
    }
    expect(caught, "a swapped receipt must not pass").to.not.equal(null);
    expect(caught.result.ok).to.equal(false);
    expect(caught.result.problems.join(" ")).to.match(/no longer verifies/);
    expect(caught.result.problems.join(" ")).to.match(/verified as GENUINE/);
  });
  it("verify.js re-derives the seed when the RPC caps log ranges", async function () {
    const { queryAll } = require("../lib/chain");
    await found({ log: noop });
    const child = await withBlockPump(breedAlive({ parentId: 1, log: noop }, noop, 8));
    // Simulate a provider that refuses any range wider than 3 blocks.
    const germline = this.germline;
    const real = germline.queryFilter.bind(germline);
    germline.queryFilter = async (filter, from, to) => {
      if (to - from > 3) throw new Error("block range too large");
      return real(filter, from, to);
    };
    process.env.GERMLINE_LOG_PAUSE_MS = "0";
    const events = await queryAll(germline, germline.filters.Spawned(), { fromBlock: 0, span: 50 });
    delete process.env.GERMLINE_LOG_PAUSE_MS;
    germline.queryFilter = real;
    expect(events.map((e) => Number(e.args.id))).to.include(child.childId);
  });
  it("queryAll waits out a throttling RPC instead of failing", async function () {
    const { queryAll } = require("../lib/chain");
    await found({ log: noop });
    await withBlockPump(breedAlive({ parentId: 1, log: noop }, noop, 8));
    const germline = this.germline;
    const real = germline.queryFilter.bind(germline);
    let calls = 0;
    germline.queryFilter = async (filter, from, to) => {
      calls++;
      if (calls % 2 === 1) throw new Error("Too Many Requests");
      return real(filter, from, to);
    };
    process.env.GERMLINE_LOG_PAUSE_MS = "0";
    process.env.GERMLINE_RPC_DELAY_MS = "1";
    const events = await queryAll(germline, germline.filters.Spawned(), {
      fromBlock: 0,
      span: 5,
    });
    germline.queryFilter = real;
    delete process.env.GERMLINE_LOG_PAUSE_MS;
    delete process.env.GERMLINE_RPC_DELAY_MS;
    expect(events.length).to.equal(1);
  });

  it("verify.js finds the birth block without scanning every log", async function () {
    await found({ log: noop });
    const child = await withBlockPump(breedAlive({ parentId: 1, log: noop }, noop, 8));
    // Pad the chain so a full scan would need many windows, then refuse any
    // log query wider than 3 blocks from the start of the chain.
    await mine(400);
    const germline = this.germline;
    const realFactory = ethers.Contract.prototype.queryFilter;
    let wide = 0;
    ethers.Contract.prototype.queryFilter = async function (filter, from, to) {
      if (to - from > 350) wide++;
      return realFactory.call(this, filter, from, to);
    };
    try {
      const result = await verify({ childId: child.childId, log: noop });
      expect(result.seed.holds).to.equal(true);
      expect(wide).to.equal(0);
    } finally {
      ethers.Contract.prototype.queryFilter = realFactory;
    }
  });
  it("verify.js finishes even when the RPC throttles every few calls", async function () {
    await found({ log: noop });
    // A mutation can land on a genome already born ("stillborn"); that is a
    // real outcome of descent, so try the next commitment rather than fail.
    let child = null;
    for (let attempt = 0; attempt < 4 && !child; attempt++) {
      try {
        child = await withBlockPump(breed({ parentId: 1, log: noop }));
      } catch (error) {
        if (!/stillborn/.test(error.message)) throw error;
      }
    }
    const provider = hre.network.provider;
    const original = provider.send;
    const wasHardened = provider.__germlineHardened;
    delete provider.__germlineHardened;
    let calls = 0;
    let refused = 0;
    provider.send = function (method, params) {
      calls++;
      if (calls % 4 === 0) {
        refused++;
        return Promise.reject(new Error("Too Many Requests"));
      }
      return original.call(provider, method, params);
    };
    process.env.GERMLINE_RPC_DELAY_MS = "1";
    try {
      const result = await verify({ childId: child.childId, log: noop });
      expect(refused).to.be.greaterThan(0);
      expect(result.genuine).to.equal(true);
      expect(result.seed.holds).to.equal(true);
    } finally {
      provider.send = original;
      if (wasHardened) provider.__germlineHardened = wasHardened;
      else delete provider.__germlineHardened;
      delete process.env.GERMLINE_RPC_DELAY_MS;
    }
  });
});
