require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// 0G network details, from docs.0g.ai. Mainnet is chain 16661; Galileo is the
// public testnet and the only one with a faucet.
//
// Avalanche C-Chain is here for the same reason paris is the EVM target: the
// contract is plain ERC-721 plus keccak256 and blockhash, so it runs anywhere
// an EVM runs. Fuji (43113) has a faucet; 43114 is mainnet. Nothing about the
// heredity mechanism is chain-specific -- only Storage and Compute are, and
// those are 0G integrations that have no Avalanche equivalent in this repo
// yet. See docs/AVALANCHE.md.
const DEPLOYER = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Target paris rather than cancun. 0G is EVM-compatible but its exact
      // EVM revision is not documented, and a contract that emits mcopy or
      // tstore would fail on deploy -- on mainnet, with real tokens. Paris
      // runs everywhere an EVM chain runs.
      evmVersion: "paris",
    },
  },
  networks: {
    // FORK_RPC runs the whole suite against a fork of a real chain. The
    // heredity mechanism reads blockhash(requestBlock), so "it passes on the
    // local EVM" is not evidence it works on a given chain -- some chains do
    // not serve historical block hashes the way the local EVM does. Point
    // FORK_RPC at Fuji and run the suite to check that for real.
    hardhat: process.env.FORK_RPC
      ? { forking: { url: process.env.FORK_RPC } }
      : {},
    zerog: {
      url: process.env.ZEROG_RPC || "https://evmrpc.0g.ai",
      chainId: 16661,
      accounts: DEPLOYER,
    },
    galileo: {
      url: process.env.GALILEO_RPC || "https://evmrpc-testnet.0g.ai",
      chainId: 16601,
      accounts: DEPLOYER,
    },
    fuji: {
      url: process.env.FUJI_RPC || "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts: DEPLOYER,
    },
    avalanche: {
      url: process.env.AVALANCHE_RPC || "https://api.avax.network/ext/bc/C/rpc",
      chainId: 43114,
      accounts: DEPLOYER,
    },
  },
  etherscan: {
    // Snowtrace verification goes through Routescan, which accepts any
    // placeholder key. npx hardhat verify --network fuji <address> 3148 500 4
    apiKey: { zerog: "none", fuji: "snowtrace", avalanche: "snowtrace" },
    customChains: [
      {
        network: "zerog",
        chainId: 16661,
        urls: {
          apiURL: "https://chainscan.0g.ai/open/api",
          browserURL: "https://chainscan.0g.ai",
        },
      },
      {
        network: "fuji",
        chainId: 43113,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan",
          browserURL: "https://testnet.snowtrace.io",
        },
      },
      {
        network: "avalanche",
        chainId: 43114,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan",
          browserURL: "https://snowtrace.io",
        },
      },
    ],
  },
};
