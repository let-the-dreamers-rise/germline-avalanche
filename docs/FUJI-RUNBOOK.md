# Running the full flow on Fuji, then C-Chain

One sitting, one wallet, about 0.5 test AVAX. Every step prints a Snowtrace
link, and the last one writes `deployments/fuji-e2e.json` with all of them.

## 0. Fund the key

Get Fuji AVAX for the deployer address from
<https://build.avax.network/console/primary-network/faucet>.

## 1. Deploy and verify the source on Snowtrace

PowerShell:

```powershell
$env:DEPLOYER_KEY="0x..."
npm run deploy:fuji
npx hardhat verify --network fuji <address from step above> 3148 500 4
```

The three numbers are the constructor arguments (survival threshold,
fecundity step, base fecundity), and they must match `scripts/deploy.js`.

## 2. Run the whole lifecycle, including the forgery

```powershell
npm run e2e:fuji
```

This does, on chain:

1. `seedFounder` + `attestFitness` for the founder genome
2. `requestSpawn` (commit), waits for the seeding block, then `spawn`
   (reveal) with the only child that seed allows, then `attestFitness`
3. `verify.js` on that child: **VERDICT: GENUINE**
4. `requestSpawn` again, then `spawn` with a genome the seed did **not**
   produce, then an honest `attestFitness` for it
5. `verify.js` on the forged child: **VERDICT: FORGED** (heredity fails)

It exits non-zero unless step 3 says GENUINE and step 5 says FORGED. The
forged organism stays on chain, so anyone can re-check it later:

```powershell
$env:CHILD_ID=3; npx hardhat run scripts/verify.js --network fuji
```

## 3. C-Chain

Same commands with `avalanche` in place of `fuji` and real AVAX on the key:

```powershell
npm run deploy:avalanche
npx hardhat verify --network avalanche <address> 3148 500 4
npm run e2e:avalanche
```

## Notes

- `verify.js` reads events in 2,000-block windows from the deployment block,
  because the public Avalanche RPC refuses wide `eth_getLogs` ranges. Set
  `GERMLINE_LOG_SPAN` lower if a provider caps it tighter.
- Commit the `deployments/*.json` files afterwards so the addresses are public.
