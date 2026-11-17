"use strict";

// Just enough of path for engine/fitness.js to name its corpus file.
module.exports = { join: function () { return Array.prototype.join.call(arguments, "/"); } };
