"use strict";

// What web/try.html needs from the SDK, bundled for the browser by
// scripts/build-web.js. The same code the CLI runs: nothing here is a
// browser-only reimplementation.

const { optimise } = require("../../sdk/optimise");
const { verifyLineage } = require("../../sdk/verify");
const { trial: supportAgent } = require("../../examples/prompt-config");
const { trial: pricing } = require("../../examples/pricing-rules");
const artifact = require("../../artifacts/contracts/Germline.sol/Germline.json");

window.GermlineTry = {
  optimise,
  verifyLineage,
  trials: { supportAgent, pricing },
  Germline: { abi: artifact.abi, bytecode: artifact.bytecode },
};
