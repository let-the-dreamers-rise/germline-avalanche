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

Two integrations are 0G-specific and have no Avalanche equivalent in this
repository:

| Component | On 0G | On Avalanche |
|---|---|---|
| Genome + transcript blobs | 0G Storage (`lib/storage.js`) | **no equivalent yet** |
| LLM-judge evaluate() | 0G Compute (`lib/compute.js`) | **no equivalent yet** |
| Agentic ID link | ERC-7857 (`linkAgenticId`) | the function is chain-agnostic; the standard's adoption is not |

Storage is the real one. The chain carries a root; the bytes have to live
somewhere a verifier can fetch them. Options, in order of how much they cost
to build:

1. **Content-addressed blobs the customer hosts.** The root is already a
   keccak hash over canonical bytes (`sdk/canonical.js`), so any HTTP host
   works and the verifier checks the hash rather than trusting the host. This
   is the smallest honest answer and it removes a dependency rather than
   adding one.
2. IPFS or Arweave, for customers who want the bytes to outlive the vendor.
3. Nothing at all -- provenance of the *lineage* works with roots alone; only
   third-party re-scoring needs the transcripts.

The compute integration is optional in the first place: `evaluate` is the
customer's own function, and `lib/compute.js` exists only for the case where a
team wants an LLM judge and has no infrastructure for one.

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

- Contract compiles for `paris` and passes 45/45 on a Fuji fork.
- Networks, explorers and deploy scripts are wired.
- **Not yet deployed to Fuji or C-Chain** -- that needs a funded key.
- Storage substitute is designed, not built.
