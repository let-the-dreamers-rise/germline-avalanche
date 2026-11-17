"use strict";

// Mirrors Germline.spawnAllowance. Kept in step with the contract by the
// test in test/engine.test.js, which checks the two agree.
//
// It lives in its own file, with no dependencies, so the SDK (and the
// browser bundle built from it) can use it without pulling in the reference
// trial's recorded data.
function spawnAllowance(
  fitnessBps,
  survivalThreshold,
  fecundityStep,
  baseFecundity
) {
  if (fitnessBps < survivalThreshold) return 0;
  return (
    baseFecundity + Math.floor((fitnessBps - survivalThreshold) / fecundityStep)
  );
}

module.exports = { spawnAllowance };
