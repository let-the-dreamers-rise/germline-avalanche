"use strict";

// Load a trial from a file that exports { trial } built with defineTrial().
// Shared by scripts/try.js and scripts/agent.js, so both accept the same
// files and fail with the same message.

const fs = require("fs");
const path = require("path");

const DEFAULT_TRIAL = path.join(__dirname, "..", "examples", "prompt-config.js");

function loadTrial(file) {
  const resolved = path.resolve(process.cwd(), file || process.env.TRIAL || DEFAULT_TRIAL);
  if (!fs.existsSync(resolved)) {
    throw new Error("TRIAL points at " + resolved + ", which does not exist");
  }
  const mod = require(resolved);
  const trial = mod && (mod.trial || mod.default || mod);
  const usable =
    trial &&
    typeof trial.evaluate === "function" &&
    typeof trial.mutate === "function" &&
    typeof trial.root === "function" &&
    trial.seed;
  if (!usable) {
    throw new Error(
      resolved +
        " must export { trial }, built with defineTrial() and given a seed " +
        "configuration. See examples/prompt-config.js for the shape."
    );
  }
  return { trial, file: path.relative(process.cwd(), resolved) || resolved };
}

module.exports = { loadTrial, DEFAULT_TRIAL };
