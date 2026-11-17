"use strict";

// Make a throwaway test wallet for trying Germline on Fuji, and put its key
// where the scripts look for it. Prints the address to fund, never the key.
//
//   npm run wallet
//
// If .env already holds a DEPLOYER_KEY, nothing is written: this prints that
// key's address instead, so running it twice is harmless.

const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const FAUCET = "https://build.avax.network/console/primary-network/faucet";

function existingKey(text) {
  const match = /^\s*DEPLOYER_KEY\s*=\s*(0x[0-9a-fA-F]{64})\s*$/m.exec(text);
  return match ? match[1] : null;
}

function main(options = {}) {
  const log = options.log || console.log;
  const file = options.file || path.join(process.cwd(), ".env");
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const found = existingKey(text);

  let address;
  if (found) {
    address = new Wallet(found).address;
    log("A wallet is already set up in " + file + ".");
  } else {
    const wallet = Wallet.createRandom();
    const line =
      (text && !text.endsWith("\n") ? "\n" : "") +
      "# Test wallet made by `npm run wallet`. Fuji only; never send real funds here.\n" +
      "DEPLOYER_KEY=" +
      wallet.privateKey +
      "\n";
    fs.writeFileSync(file, text + line, { mode: 0o600 });
    address = wallet.address;
    log("Made a new test wallet. Its key is in " + file + " (keep that file private).");
  }

  log("");
  log("Address: " + address);
  log("");
  log("Next: get free test AVAX for that address at");
  log("  " + FAUCET);
  log("(or ask whoever sent you here), then run:  npm run try:fuji");
  return address;
}

if (require.main === module) main();

module.exports = { main, existingKey };
