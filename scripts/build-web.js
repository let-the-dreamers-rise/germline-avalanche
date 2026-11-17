"use strict";

// Bundle the SDK for web/try.html.
//
//   npx hardhat compile && npm run build:web
//
// Writes web/try-bundle.js. ethers is not bundled: the page loads it from a
// CDN and the bundle reuses that copy (web/src/shims/ethers.js).

const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const artifact = path.join(root, "artifacts", "contracts", "Germline.sol", "Germline.json");
if (!fs.existsSync(artifact)) {
  console.error("No compiled contract at " + artifact + ". Run `npx hardhat compile` first.");
  process.exit(1);
}

esbuild.buildSync({
  absWorkingDir: root,
  entryPoints: ["web/src/try-entry.js"],
  outfile: "web/try-bundle.js",
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  alias: {
    fs: "./web/src/shims/empty.js",
    path: "./web/src/shims/empty.js",
    ethers: "./web/src/shims/ethers.js",
  },
  define: { "process.env": "{}", __dirname: '""' },
  legalComments: "none",
  banner: { js: "/* Built by scripts/build-web.js from sdk/ and examples/. Do not edit by hand. */" },
  logLevel: "info",
});
