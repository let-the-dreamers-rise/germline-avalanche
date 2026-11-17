"use strict";

// Bundle the SDK for the web pages.
//
//   npx hardhat compile && npm run build:web
//
// Writes web/try-bundle.js (the search and on-chain run for web/try.html)
// and web/live-bundle.js (the read-only check of the live Fuji registry,
// which carries the ARC corpus and so loads only when someone asks for it).
// ethers is not bundled: the pages load it from a CDN and the bundles reuse
// that copy (web/src/shims/ethers.js).

const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const artifact = path.join(root, "artifacts", "contracts", "Germline.sol", "Germline.json");
if (!fs.existsSync(artifact)) {
  console.error("No compiled contract at " + artifact + ". Run `npx hardhat compile` first.");
  process.exit(1);
}

const common = {
  absWorkingDir: root,
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  define: { "process.env": "{}", __dirname: '""' },
  legalComments: "none",
  banner: { js: "/* Built by scripts/build-web.js from sdk/, engine/ and examples/. Do not edit by hand. */" },
  logLevel: "info",
};

esbuild.buildSync({
  ...common,
  entryPoints: ["web/src/try-entry.js"],
  outfile: "web/try-bundle.js",
  alias: {
    fs: "./web/src/shims/empty.js",
    path: "./web/src/shims/empty.js",
    ethers: "./web/src/shims/ethers.js",
  },
});

esbuild.buildSync({
  ...common,
  entryPoints: ["web/src/live-entry.js"],
  outfile: "web/live-bundle.js",
  alias: {
    fs: "./web/src/shims/arc-fs.js",
    path: "./web/src/shims/path.js",
    ethers: "./web/src/shims/ethers.js",
  },
});
