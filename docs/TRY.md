# Try Germline

**Quickest: in your browser.** Open the
[try page](https://germline-avalanche.vercel.app/try). It runs a real search on
your screen with nothing to install, then records it on Avalanche Fuji from a
throwaway test wallet the page makes for you, and checks every organism against
the chain. The page is `web/try.html` in this repo; open it locally with any
static file server if you prefer.

On your own machine there are three levels. Each one takes the one before it a
step further, and you can stop at any of them.

You need [Node.js](https://nodejs.org) 18 or newer and
[git](https://git-scm.com). The commands are the same in Windows Command
Prompt, PowerShell, macOS and Linux.

```
git clone https://github.com/let-the-dreamers-rise/germline-avalanche
cd germline-avalanche
npm install
```

## 1. On your machine, no wallet (about a minute)

```
npm run try:local
```

This starts a throwaway chain inside the process, deploys a Germline registry,
and runs a real search over the example trial: tuning a retrieval agent's four
settings (`examples/prompt-config.js`). Every configuration it tries is
recorded on that chain as it goes, bred by commit-reveal from a block hash that
did not exist yet. At the end it reads every organism back and checks it:

```
organism 1 (founder)    retrievalDepth=3 rerank=off ...  4576 bps  ...  -> GENUINE
organism 2 (child of 1) retrievalDepth=3 rerank=off ...  5276 bps  heredity VERIFIED  score VERIFIED  -> GENUINE
...
best found       retrievalDepth=5 rerank=on temperature=0.3 toolPolicy=eager  8395 bps (+3819)
```

Every run differs, because the seeds come from block hashes.

## 2. On Avalanche Fuji, from your own wallet (about five minutes)

Same run, on a public chain, so anyone can check it on Snowtrace.

**Make a test wallet.** This writes a fresh key into `.env` (which git ignores)
and prints its address. Use it only for testing.

```
npm run wallet
```

**Get free test AVAX** for that address at the
[Avalanche faucet](https://build.avax.network/console/primary-network/faucet).
A run costs well under 0.1 test AVAX. If the faucet won't serve you, ask
whoever pointed you here to send some.

**Run it:**

```
npm run try:fuji
```

It deploys a registry that **you** own and curate, records the search from your
wallet (typically 15 to 40 small transactions), verifies every organism against
Fuji, and ends with one link:

```
Share this link. Every transaction above is on that page:
  https://testnet.snowtrace.io/address/0x...
```

Run it again whenever you like. To keep adding to the same registry rather than
deploying a new one, put `TRY_CONTRACT=0x...` (the address from that link) in
`.env`.

## 3. Your own configuration and your own eval

This is the real use. Copy an example and make it yours:

```
copy examples\prompt-config.js examples\my-trial.js      (Windows)
cp examples/prompt-config.js examples/my-trial.js        (macOS, Linux)
```

In `my-trial.js`, change three things:

- `genes`: the settings you actually tune. Types are `bool`, `int` (min, max),
  `choice` (options) and `mask` (bits). See [SDK.md](SDK.md).
- `seed`: what you run today.
- `evaluate`: call your real eval and return `{ score, evidence }`. A score in
  0..1 is read as a fraction. Keep it deterministic, or average enough runs
  that noise is small: the lineage will faithfully record whatever you measure.

Then add one line to `.env` and run it:

```
TRIAL=examples/my-trial.js
```

```
npm run try:local      (free, to check it works)
npm run try:fuji       (on chain, to share)
```

Nothing about your eval leaves your machine. The chain stores a 32-byte hash of
each configuration and its score; the configurations themselves stay with you.

## What the run proves, and what it doesn't

It proves where a configuration came from: which parent, which seed, and that
the seed was fixed by a block that did not exist when you committed. It proves
the score you attested is the score `evaluate` gives. It does not prove your
eval measures the right thing. That part is yours, and it is worth more care
than anything here.

Settings, all optional, in `.env`: `TRIAL`, `GENERATIONS` (default 4),
`TRY_FECUNDITY` (children per organism at the survival bar, default 3),
`TRY_CONTRACT`.
