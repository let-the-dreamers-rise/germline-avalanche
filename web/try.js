// The try page's behaviour: run a search locally, then record and verify it
// on chain from a burner wallet. Loaded by web/try.html after ethers and
// try-bundle.js.
(function () {
  "use strict";
  var G = window.GermlineTry;
  var E = window.ethers;
  var $ = function (id) { return document.getElementById(id); };

  // ---- settings: Fuji by default; ?rpc=&chain= for a local test chain ----
  var params = new URLSearchParams(location.search);
  var CHAIN_ID = Number(params.get("chain") || 43113);
  var RPCS = params.get("rpc") ? [params.get("rpc")] : [
    "https://api.avax-test.network/ext/bc/C/rpc",
    "https://avalanche-fuji-c-chain-rpc.publicnode.com"
  ];
  var EXPLORER = CHAIN_ID === 43113 ? "https://testnet.snowtrace.io" : null;
  var GENERATIONS = Number(params.get("generations") || 4);
  var FECUNDITY = 4;
  var GAS_BUDGET = 10000000n;
  var KEY_STORE = "germline-try-key-" + CHAIN_ID;
  var REG_STORE = "germline-try-registry-" + CHAIN_ID;

  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    } catch (e) { return null; }
  }
  function txUrl(h) { return EXPLORER ? EXPLORER + "/tx/" + h : null; }
  function addrUrl(a) { return EXPLORER ? EXPLORER + "/address/" + a : null; }
  function pct(bps) { return (bps / 100).toFixed(1) + "%"; }
  function signed(n) { return (n > 0 ? "+" : "") + (n / 100).toFixed(1); }
  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }
  function chosenTrial() {
    var picked = document.querySelector('input[name="trial"]:checked').value;
    return G.trials[picked];
  }
  function label(trial, config) { return trial.label(config); }

  // ---- step 1: the same optimise(), locally --------------------------------
  $("run-local").addEventListener("click", async function () {
    var trial = chosenTrial();
    var button = this;
    button.disabled = true;
    $("local-status").textContent = "running...";
    try {
      var run = await G.optimise(trial, { generations: 8, baseFecundity: 6, salt: trial.name + ":" + Date.now() });
      var founder = run.founder, best = run.best;
      $("l-start").textContent = pct(founder.fitnessBps);
      $("l-start-cfg").textContent = label(trial, founder.config);
      $("l-best").textContent = pct(best.fitnessBps) + " (" + signed(best.fitnessBps - founder.fitnessBps) + ")";
      $("l-best-cfg").textContent = label(trial, best.config);
      $("l-tried").textContent = String(run.population.length);
      $("l-space").textContent = "of " + Number(trial.size()).toLocaleString() + " possible";
      var rows = $("l-rows");
      rows.textContent = "";
      var byId = {};
      run.population.forEach(function (o) { byId[o.id] = o; });
      run.population.forEach(function (o) {
        var tr = el("tr", o === best ? { "class": "best" } : null);
        tr.appendChild(el("td", { "class": "num" }, String(o.id)));
        tr.appendChild(el("td", { "class": "num" }, o.parent ? String(o.parent) : "start"));
        tr.appendChild(el("td", { "class": "cfg" }, label(trial, o.config)));
        tr.appendChild(el("td", { "class": "num" }, pct(o.fitnessBps)));
        var d = o.parent ? o.fitnessBps - byId[o.parent].fitnessBps : 0;
        tr.appendChild(el("td", { "class": "num " + (d > 0 ? "up" : "down") }, o.parent ? signed(d) : ""));
        rows.appendChild(tr);
      });
      var path = [];
      for (var cur = best; cur; cur = cur.parent ? byId[cur.parent] : null) path.unshift(cur);
      var pathRows = $("l-path");
      pathRows.textContent = "";
      path.forEach(function (o, i) {
        var tr = el("tr", o === best ? { "class": "best" } : null);
        tr.appendChild(el("td", { "class": "num" }, String(o.id)));
        tr.appendChild(el("td", { "class": "cfg" }, label(trial, o.config)));
        tr.appendChild(el("td", { "class": "num" }, pct(o.fitnessBps)));
        var d = i ? o.fitnessBps - path[i - 1].fitnessBps : 0;
        tr.appendChild(el("td", { "class": "num " + (d > 0 ? "up" : "down") }, i ? signed(d) : "start"));
        pathRows.appendChild(tr);
      });
      $("local-out").hidden = false;
      $("local-status").textContent = "done. Run it again for a different path.";
    } catch (e) {
      $("local-status").textContent = "failed: " + (e.message || e);
    } finally {
      button.disabled = false;
    }
  });

  // ---- step 2: wallet, funding, on-chain run ----------------------------------
  var provider = null, wallet = null, balance = 0n, needed = 0n, busy = false;

  async function pickProvider() {
    for (var i = 0; i < RPCS.length; i++) {
      try {
        // No response cache: a nonce or a seed read twice in quick succession
        // must come from the chain both times.
        var p = new E.JsonRpcProvider(RPCS[i], CHAIN_ID, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
        p.pollingInterval = 1000;
        var got = await p.send("eth_chainId", []);
        if (Number(got) === CHAIN_ID) return p;
      } catch (e) { /* try the next one */ }
    }
    throw new Error("could not reach a Fuji RPC endpoint from this browser");
  }

  function loadWallet() {
    var key = store(KEY_STORE);
    if (!key) {
      key = E.Wallet.createRandom().privateKey;
      store(KEY_STORE, key);
    }
    return new E.Wallet(key);
  }

  function avax(wei) {
    var n = Number(E.formatEther(wei));
    return n < 0.001 ? "less than 0.001 AVAX" : n.toFixed(3) + " AVAX";
  }

  async function refreshBalance() {
    if (!provider || !wallet) return;
    try {
      balance = await provider.getBalance(wallet.address);
      var fee = await provider.getFeeData();
      var price = fee.gasPrice || fee.maxFeePerGas || 0n;
      needed = price * GAS_BUDGET;
      $("w-balance").textContent = Number(E.formatEther(balance)).toFixed(4) + " AVAX";
      $("w-need").textContent = balance >= needed ? "enough for a run" : "a run needs about " + avax(needed);
      $("run-chain").disabled = busy || balance < needed;
    } catch (e) {
      $("w-balance").textContent = "could not read (" + (e.shortMessage || e.message) + ")";
    }
  }

  async function initChain() {
    wallet = loadWallet();
    var a = $("w-address");
    a.textContent = "";
    if (addrUrl(wallet.address)) {
      var link = el("a", { href: addrUrl(wallet.address), target: "_blank", rel: "noopener" }, wallet.address);
      a.appendChild(link);
    } else {
      a.textContent = wallet.address;
    }
    $("w-net").textContent = CHAIN_ID === 43113 ? "Avalanche Fuji (43113)" : "chain " + CHAIN_ID;
    try {
      provider = await pickProvider();
    } catch (e) {
      $("w-balance").textContent = e.message;
      return;
    }
    wallet = wallet.connect(provider);
    await refreshBalance();
    setInterval(refreshBalance, 8000);
  }

  $("copy-address").addEventListener("click", async function () {
    try { await navigator.clipboard.writeText(wallet.address); this.textContent = "Copied"; }
    catch (e) { this.textContent = wallet.address; }
  });

  $("fund-wallet").addEventListener("click", async function () {
    var status = $("fund-status");
    if (!window.ethereum) {
      status.textContent = "No browser wallet found. Use the faucet link, or copy the address and send test AVAX from any Fuji wallet.";
      return;
    }
    try {
      var hex = "0x" + CHAIN_ID.toString(16);
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
      } catch (switchError) {
        if (switchError.code !== 4902 || CHAIN_ID !== 43113) throw switchError;
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
          chainId: hex, chainName: "Avalanche Fuji C-Chain",
          nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
          rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
          blockExplorerUrls: ["https://testnet.snowtrace.io"]
        }] });
      }
      var browser = new E.BrowserProvider(window.ethereum);
      var signer = await browser.getSigner();
      var net = await browser.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID) throw new Error("your wallet is not on the Fuji network");
      status.textContent = "Confirm the transfer in your wallet...";
      var tx = await signer.sendTransaction({ to: wallet.address, value: E.parseEther("0.1") });
      status.textContent = "Sent, waiting for it to land...";
      await tx.wait();
      status.textContent = "Funded.";
      await refreshBalance();
    } catch (e) {
      status.textContent = "Not sent: " + (e.shortMessage || e.message || e);
    }
  });

  function logLine(text) {
    var log = $("chain-log");
    log.hidden = false;
    var line = el("div");
    var m = /\(tx (0x[0-9a-fA-F]{64})\)/.exec(text);
    if (m && txUrl(m[1])) {
      var at = text.indexOf(m[0]);
      line.appendChild(document.createTextNode(text.slice(0, at) + "("));
      line.appendChild(el("a", { href: txUrl(m[1]), target: "_blank", rel: "noopener" }, m[1].slice(0, 10) + "…"));
      line.appendChild(document.createTextNode(")" + text.slice(at + m[0].length)));
    } else {
      line.textContent = text;
    }
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  $("run-chain").addEventListener("click", async function () {
    if (busy) return;
    busy = true;
    var button = this;
    button.disabled = true;
    $("chain-error").hidden = true;
    $("chain-out").hidden = true;
    $("chain-log").textContent = "";
    var status = $("chain-status");
    var trial = chosenTrial();
    var txCount = 0;
    var log = function (line) { if (/\(tx 0x/.test(line)) txCount++; logLine(line); };
    // Count nonces here rather than asking the RPC before every send: a
    // load-balanced public endpoint can answer from a node a block behind,
    // and a stale nonce fails the transaction. Fresh for every run, so a
    // run that stopped halfway cannot leave a gap behind it.
    var signer = new E.NonceManager(wallet);
    try {
      // A fresh registry per run: the founder's own score is its survival
      // bar, and nothing from an earlier run can stand in the way.
      status.textContent = "deploying your registry...";
      var founder = await trial.evaluate(trial.seed);
      var factory = new E.ContractFactory(G.Germline.abi, G.Germline.bytecode, signer);
      var contract = await factory.deploy(founder.fitnessBps, 500, FECUNDITY);
      await contract.waitForDeployment();
      var address = await contract.getAddress();
      txCount++;
      log("deployed your registry " + address + " (tx " + contract.deploymentTransaction().hash + ")");
      log("  survival bar " + founder.fitnessBps + " bps, the starting configuration's own score");
      var past;
      try { past = JSON.parse(store(REG_STORE) || "[]"); if (!Array.isArray(past)) past = []; } catch (e) { past = []; }
      past.push(address);
      store(REG_STORE, JSON.stringify(past.slice(-20)));
      status.textContent = "breeding on chain...";
      var run = await G.optimise(trial, {
        generations: GENERATIONS,
        log: log,
        chain: { contract: contract, signer: signer, pollMs: 1500, pollTries: 80 }
      });
      status.textContent = "verifying against the chain...";
      log("verifying every organism against the chain...");
      var checks = await G.verifyLineage(trial, contract, run.population);
      var genuine = checks.filter(function (c) { return c.verdict === "GENUINE"; }).length;
      var children = checks.filter(function (c) { return c.parent; }).length;

      $("c-count").textContent = String(checks.length);
      $("c-tx").textContent = "organisms, " + children + " bred by commit-reveal, " + txCount + " transactions";
      $("c-verified").textContent = genuine + " of " + checks.length;
      $("c-best").textContent = pct(run.best.fitnessBps) + " (" + signed(run.best.fitnessBps - run.founder.fitnessBps) + ")";
      $("c-best-cfg").textContent = run.best.fitnessBps > run.founder.fitnessBps
        ? label(trial, run.best.config)
        : "No child beat the starting point this time, so the survival rule stopped them from breeding. That is selection working. Run it again for new seeds.";
      var rows = $("c-rows");
      rows.textContent = "";
      checks.forEach(function (c) {
        var tr = el("tr", c.label === run.best.label ? { "class": "best" } : null);
        tr.appendChild(el("td", { "class": "num" }, "#" + c.id + (c.parent ? " ← #" + c.parent : " start")));
        tr.appendChild(el("td", { "class": "cfg" }, c.label));
        tr.appendChild(el("td", { "class": "num" }, pct(c.fitnessBps)));
        var her = el("td"); her.appendChild(el("span", { "class": "badge " + (c.heredity === false ? "bad" : "ok") }, c.heredity === null ? "founder" : c.heredity ? "verified" : "failed"));
        tr.appendChild(her);
        var sc = el("td"); sc.appendChild(el("span", { "class": "badge " + (c.scoreHolds && c.evidenceHolds ? "ok" : "bad") }, !c.attested ? "not attested" : c.scoreHolds && c.evidenceHolds ? "verified" : "failed"));
        tr.appendChild(sc);
        var v = el("td"); v.appendChild(el("span", { "class": "badge " + (c.verdict === "GENUINE" ? "ok" : "bad") }, c.verdict));
        tr.appendChild(v);
        rows.appendChild(tr);
      });
      var share = $("c-share");
      share.textContent = "";
      if (addrUrl(address)) {
        share.appendChild(el("div", null, "Your registry, with every transaction above. Share this link:"));
        share.appendChild(el("a", { href: addrUrl(address), target: "_blank", rel: "noopener" }, addrUrl(address)));
      } else {
        share.appendChild(el("div", null, "Your registry: " + address));
      }
      $("chain-out").hidden = false;
      status.textContent = genuine === checks.length ? "done, all verified." : "done, but some organisms did not verify.";
      window.__germlineLastRun = { address: address, checks: checks, txCount: txCount };
    } catch (e) {
      console.error("germline try failed", e);
      var err = $("chain-error");
      err.textContent = "Stopped: " + (e.shortMessage || e.message || e) + "\nAnything already sent stays on chain. Check the balance and run it again.";
      err.hidden = false;
      status.textContent = "";
    } finally {
      busy = false;
      await refreshBalance();
    }
  });

  initChain();
})();
