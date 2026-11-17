"use strict";

// engine/fitness.js reads exactly one file, the ARC reference corpus. In the
// browser there is no file system, so this hands over the same corpus from
// the bundle. Its trial id is computed from the parsed rows, so it matches
// the one the CLI computes from disk.

const corpus = require("../../../engine/trial/arc-transitions.json");
const text = JSON.stringify(corpus);

module.exports = { readFileSync: function () { return text; } };
