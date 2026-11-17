// The page loads ethers once from a CDN; the bundle reuses that copy rather
// than shipping a second one.
module.exports = window.ethers;
