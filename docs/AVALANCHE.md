# Germline on Avalanche

Germline was built and deployed on 0G. This document is the honest account of
what moving to Avalanche C-Chain costs, what carries over unchanged, and what
does not carry over at all.

## What carries over unchanged

The mechanism. `contracts/Germline.sol` is an ERC-721 plus `keccak256` and
`blockhash` -- no precompiles, no chain-specific opcodes, compiled against
`paris` precisely so it runs anywhere an EVM runs.

That was the claim. Here is the check:

```bash
FORK_RPC=https://api.avax-test.network/ext/bc/C/rpc npx hardhat test
```

**45 passing**, against a fork of Avalanche Fuji -- including the two tests
that matter most:

- `breeds one honest child that verify.js accepts as genuine`
- `rejects a forged child whose genome root does not match its recorded seed`

This was not a formality. Heredity is seeded from
`blockhash(requestBlock)`, and a chain that does not serve historical block
hashes the way the local EVM does would break the commit-reveal silently --
seeds would come back zero and every lineage would verify against a constant.
Running the suite against a real Fuji fork is the only way to know, and it
passes.

## What does not carry over

Two integrations were 0G-specific. One is now solved; one remains optional.

| Component | On 0G | On Avalanche |
|---|---|---|
| Genome + transcript blobs | 0G Storage (`lib/storage.js`) | **`lib/store.js`** — content-addressed, any host |
| LLM-judge evaluate() | 0G Compute (`lib/compute.js`) | not needed; `evaluate` is the customer's own function |
| Agentic ID link | ERC-7857 (`linkAgenticId`) | the function is chain-agnostic; the standard's adoption is not |

### Storage: solved by removing the dependency, not replacing it

The chain carries a root; the bytes have to live somewhere a verifier can
fetch them. The obvious move is to find another network-flavoured blob service
and depend on that instead. That would be the wrong instinct.

A root is `keccak256` over canonical bytes (`sdk/canonical.js`), computed by
us, from bytes we hold. So a reader can check what they were handed. The store
therefore does not need to be trusted, decentralised, or even well-behaved --
it needs to return the bytes, and if it returns different ones the hash says so
and `lib/store.js` refuses them.

So the answer for Avalanche is not another dependency. It is **no** dependency:

```
GERMLINE_STORE=fs     files under GERMLINE_STORE_DIR (default)
GERMLINE_STORE=http   read from GERMLINE_STORE_URL, write if PUT is set
GERMLINE_STORE=0g     delegate to lib/storage.js, unchanged
```

A plain directory the operator rsyncs to any static host is a complete answer.
IPFS or Arweave remain available for customers who want the bytes to outlive
the vendor, but they are a preference now rather than a requirement.

Every read verifies, and there is no flag to disable it -- a store whose
contents are not checked is a store you are trusting, which is what the root
exists to avoid. Eight tests cover the refusals specifically, including the
case that matters: same filename, different bytes.

```bash
npm run check:store
```

writes a payload, reads it back, then corrupts it on disk and confirms the read
is refused.

The compute integration needed no substitute at all: `evaluate` is the
customer's own function, and `lib/compute.js` exists only for teams who want an
LLM judge and have no infrastructure for one.

## Why Avalanche is a good host for this specifically

Not chain-agnostic boilerplate -- two reasons that are about this mechanism.

**Finality is dead time here.** Reproduction is deliberately two
transactions: `requestSpawn` commits to breeding at a block whose hash does
not yet exist, and `spawn` reveals afterwards. The wait between them is time a
user spends staring at a spinner, and it exists for a security reason that
cannot be optimised away. Sub-second finality turns that from a UX problem
into a non-issue.

**A per-customer L1 is the regulated-deployment story.** The provenance tier
sells to teams whose own customers ask "which version produced this output".
Those buyers frequently cannot put anything on a public chain. An Avalanche L1
lets a customer run the same registry, the same contract and the same
`verify.js` on a chain they control -- which is a product shape that does not
exist on a monolithic chain. This is the part of the Avalanche thesis that is
actually load-bearing for Germline rather than decorative.

## Deploying

```bash
DEPLOYER_KEY=0x... npm run deploy:fuji        # 43113, faucet-funded
DEPLOYER_KEY=0x... npm run deploy:avalanche   # 43114, real AVAX
```

Both write `deployments/<network>.json`, and every lifecycle script refuses to
act if the RPC reports a different chain than the record
(`assertChainMatches`). Explorer links resolve to Snowtrace.

The faucet is at <https://build.avax.network/console/primary-network/faucet>.

## Status

- Contract compiles for `paris`; **62/62 tests pass** locally, and the original 53 pass
  against a live Fuji fork.
- Networks, explorers and deploy scripts are wired.
- Storage substitute is **built and tested** (`lib/store.js`), and the 0G
  Storage dependency is gone unless a customer wants it.
- **Live on Fuji** since 16 Nov 2026 at
  [`0xA0448Cd63f746a60447cfF1817ec9781C25F7b25`](https://testnet.snowtrace.io/address/0xA0448Cd63f746a60447cfF1817ec9781C25F7b25),
  source verified on Snowtrace. The full flow ran on chain: an honest child
  verifies GENUINE and a deliberately forged child verifies FORGED. Every
  transaction is in [`deployments/fuji-e2e.json`](../deployments/fuji-e2e.json).
  (The address matches the 0G registry because it is the same deployer at the
  same nonce. It is a separate contract on a separate chain.)
- **C-Chain mainnet: not yet.** Same commands with `avalanche` in place of
  `fuji`; see [FUJI-RUNBOOK.md](FUJI-RUNBOOK.md).

Re-check both organisms yourself. It only reads, so it needs no key and no
gas:

```
npm install
npm run recheck:fuji
```

It passes only if the honest child still verifies GENUINE and the forged child
is still rejected FORGED on heredity alone, with both seeds re-derived from
Fuji's own block hashes. The same command runs in CI on every push
([Fuji re-check](https://github.com/let-the-dreamers-rise/germline-avalanche/actions/workflows/fuji.yml)),
and the verdict table is on each run's summary page.

One thing worth knowing before you click through to Snowtrace: the forged
child's reveal transaction **succeeds** on chain, and that is by design. The
contract records the commitment, the seed and the revealed root. It holds
roots, not genomes, so it cannot run the mutation itself. What fails is
re-deriving that child from its parent and the recorded seed, and anyone can
do that, forever, without asking the breeder for anything.

To look at one organism in full (PowerShell):

```powershell
$env:CHILD_ID=3; npx hardhat run scripts/verify.js --network fuji
```
