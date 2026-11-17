"use strict";

// The live check for web pages, bundled by scripts/build-web.js into
// web/live-bundle.js. It runs the same heredity, seed and score checks as
// scripts/verify.js against the public Fuji registry, from the visitor's
// browser, with no wallet.

const { checkLive } = require("../../sdk/live-check");
const artifact = require("../../artifacts/contracts/Germline.sol/Germline.json");
const receipt = require("../../deployments/fuji-e2e.json");

// The receipt stores explorer links; the check needs the bare hash.
function hashOf(value) {
  const match = /0x[0-9a-fA-F]{64}/.exec(String(value || ""));
  return match ? match[0] : null;
}

window.GermlineLive = {
  checkLive,
  abi: artifact.abi,
  receipt,
  hashOf,
};
