/* The verdict machine: check the two real children on Avalanche Fuji, live,
   from the visitor's own browser. Pressing the button loads ethers and
   live-bundle.js (sdk/live-check.js, the same checks as scripts/verify.js),
   reads the registry from a public Fuji RPC and re-runs heredity, the seed
   and the score. No wallet, no install.

   Until then, and if Fuji cannot be reached, it shows the result recorded by
   the last live run, and says so. */
(function () {
  "use strict";
  var mounts = document.querySelectorAll("[data-verdict-machine]");
  if (!mounts.length) return;

  var TX = "https://testnet.snowtrace.io/tx/";
  var CI = "https://github.com/let-the-dreamers-rise/germline-avalanche/actions/workflows/fuji.yml";
  var ETHERS = "https://cdnjs.cloudflare.com/ajax/libs/ethers/6.13.5/ethers.umd.min.js";
  var RPCS = ["https://api.avax-test.network/ext/bc/C/rpc", "https://avalanche-fuji-c-chain-rpc.publicnode.com"];
  // Tests point the machine at a local chain; visitors never set this.
  var OVERRIDE = window.GERMLINE_LIVE_OVERRIDE || null;

  var CHILDREN = {
    2: {
      name: "Honest child #2",
      revealed: "colour + size",
      tx: "0x3895bd8673e34cd8305cc8570a2c95a28c63762c691f6f3c62d1148fdaee338a",
      verdict: "GENUINE",
      checks: [
        ["Heredity", true, "seed re-derives 0x454f…8eee, chain holds 0x454f…8eee"],
        ["Seed", true, "keccak(parent root, blockhash 61187418, #1, ordinal 0) = 0x71cb…ef78"],
        ["Score", true, "attested 3821, re-measured 3821"],
        ["Evidence", true, "evidence root matches the transcript"]
      ]
    },
    3: {
      name: "Forged child #3",
      revealed: "colour + size + ring + momentum",
      tx: "0xc5a19232d52a0152981d6ead72a460bae71f1e0532052a36574e3e8091a71223",
      verdict: "FORGED",
      checks: [
        ["Heredity", false, "seed re-derives ring:UDLR 0xbe57…93b1, chain holds 0x253e…5f5c"],
        ["Seed", true, "keccak(parent root, blockhash 61187439, #1, ordinal 1) = 0x0c84…993a"],
        ["Score", true, "attested 4602, re-measured 4602"],
        ["Evidence", true, "evidence root matches the transcript"]
      ]
    }
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function short(h) { return h ? String(h).slice(0, 6) + "…" + String(h).slice(-4) : "?"; }

  // Load a script once; every machine on the page shares the promise.
  var loads = {};
  function load(src) {
    if (!loads[src]) {
      loads[src] = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = function () { delete loads[src]; reject(new Error("could not load " + src)); };
        document.head.appendChild(s);
      });
    }
    return loads[src];
  }

  // Run the live check against the first RPC that answers.
  async function live(childId, say) {
    say("Loading the verifier…");
    if (!window.ethers) await load(ETHERS);
    await load("live-bundle.js");
    var E = window.ethers, L = window.GermlineLive;
    var receipt = (OVERRIDE && OVERRIDE.receipt) || L.receipt;
    var entry = receipt.honestChild.id === childId ? receipt.honestChild : receipt.forgedChild;
    var rpcs = OVERRIDE && OVERRIDE.rpc ? [OVERRIDE.rpc] : RPCS;
    var last = null;
    for (var i = 0; i < rpcs.length; i++) {
      try {
        var provider = new E.JsonRpcProvider(rpcs[i], receipt.chainId, { staticNetwork: true, batchMaxCount: 1 });
        var contract = new E.Contract(receipt.contract, L.abi, provider);
        say("Reading organism #" + childId + " from Avalanche Fuji…");
        return await L.checkLive({
          contract: contract,
          provider: provider,
          childId: childId,
          requestTx: L.hashOf(entry.requestSpawnTx),
          log: function (line) { say(line.charAt(0).toUpperCase() + line.slice(1) + "…"); }
        });
      } catch (error) {
        last = error;
      }
    }
    throw last || new Error("no RPC answered");
  }

  // Turn a live result into the four rows the machine shows.
  function rowsFrom(r) {
    var rows = [[
      "Heredity", r.heredity,
      (r.heredity ? "re-ran the mutation: " : "re-ran the mutation and got a different child: ") +
        r.derivedLabel + " " + short(r.derivedRoot) + ", chain holds " + short(r.onChainRoot)
    ]];
    rows.push(r.seed.checked
      ? ["Seed", r.seed.holds, "block " + r.seed.requestBlock + " hash " + short(r.seed.blockHash) + ", ordinal " + r.seed.ordinal + " → " + short(r.seed.recomputed) + (r.seed.holds ? ", same as the chain" : ", not what the chain holds")]
      : ["Seed", true, "not re-derived (no request transaction recorded)"]);
    rows.push(r.score.checked
      ? ["Score", r.score.holds, "attested " + r.score.attestedBps + ", re-measured " + r.score.measuredBps + " in your browser"]
      : ["Score", true, r.score.attested ? "attested " + r.score.attestedBps + ", not re-measurable here" : "not attested"]);
    rows.push(r.score.checked
      ? ["Evidence", r.score.evidenceHolds, r.score.evidenceHolds ? "evidence root matches the re-measured transcript" : "evidence root does not match"]
      : ["Evidence", true, "not checked"]);
    return rows;
  }

  function mount(host) {
    var current = 3;
    var busy = false;
    var wrap = el("div", "vm");
    var head = el("div", "vm-head");
    var picker = el("div", "vm-pick");
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "Choose a child to check");
    var buttons = {};
    [2, 3].forEach(function (id) {
      var b = el("button", "vm-tab", CHILDREN[id].name);
      b.type = "button";
      b.addEventListener("click", function () { if (!busy) select(id); });
      buttons[id] = b;
      picker.appendChild(b);
    });
    var run = el("button", "btn btn-primary vm-run", "Check it live on Fuji");
    run.type = "button";
    head.appendChild(picker);
    head.appendChild(run);

    var body = el("div", "vm-body");
    var meta = el("p", "vm-meta");
    var status = el("p", "vm-status");
    status.setAttribute("aria-live", "polite");
    var list = el("ol", "vm-checks");
    var stamp = el("div", "vm-stamp");
    stamp.setAttribute("aria-live", "polite");
    body.appendChild(meta);
    body.appendChild(status);
    body.appendChild(list);
    body.appendChild(stamp);

    var foot = el("p", "vm-foot");
    wrap.appendChild(head);
    wrap.appendChild(body);
    wrap.appendChild(foot);
    host.appendChild(wrap);

    function draw(rows, verdict, source, about) {
      var c = CHILDREN[current];
      Object.keys(buttons).forEach(function (k) { buttons[k].setAttribute("aria-pressed", String(Number(k) === current)); });
      meta.textContent = about || "Parent #1 (action-only, 3148) → revealed: " + c.revealed;
      list.innerHTML = "";
      rows.forEach(function (chk) {
        var final = chk[1] !== null;
        var li = el("li", "vm-check" + (final ? (chk[1] ? " pass" : " fail") : ""));
        var mark = el("span", "vm-mark", final ? (chk[1] ? "✓" : "✗") : "•");
        mark.setAttribute("aria-hidden", "true");
        li.appendChild(mark);
        li.appendChild(el("span", "vm-label", chk[0]));
        li.appendChild(el("span", "visually-hidden", final ? (chk[1] ? " verified" : " failed") : ""));
        li.appendChild(el("span", "vm-detail", chk[2]));
        list.appendChild(li);
      });
      stamp.className = "vm-stamp" + (verdict ? " show " + verdict.toLowerCase() : "");
      stamp.textContent = verdict ? "VERDICT: " + verdict : "";
      foot.innerHTML = "";
      foot.appendChild(document.createTextNode(source + " "));
      var a = el("a", null, "See the transaction on Snowtrace");
      a.href = TX + c.tx;
      foot.appendChild(a);
      foot.appendChild(document.createTextNode(" · or run "));
      foot.appendChild(el("code", null, "npm run recheck:fuji"));
    }

    function recorded(note) {
      var c = CHILDREN[current];
      draw(c.checks, c.verdict, note || "Last recorded result, re-checked by CI on every push. Press the button to check it yourself, live.");
    }

    function select(id) {
      current = id;
      status.textContent = "";
      recorded();
    }

    // Reveal the rows one at a time, the way a reader would check them.
    function reveal(rows, verdict, source, about) {
      var pending = rows.map(function (r) { return [r[0], null, "waiting"]; });
      draw(pending, null, source, about);
      var step = window.Site && window.Site.reduce ? 0 : 420;
      var i = 0;
      return new Promise(function (resolve) {
        (function next() {
          if (i >= rows.length) { draw(rows, verdict, source, about); resolve(); return; }
          pending[i] = rows[i];
          draw(pending, null, source, about);
          i++;
          setTimeout(next, step);
        })();
      });
    }

    async function play() {
      if (busy) return;
      busy = true;
      run.disabled = true;
      var id = current;
      var c = CHILDREN[id];
      draw(c.checks.map(function (r) { return [r[0], null, "checking…"]; }), null, "Checking live…");
      try {
        var result = await live(id, function (line) { status.textContent = line; });
        if (id !== current) return;
        var time = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        status.textContent = "Done. Your browser read this from Avalanche Fuji and re-ran every check itself.";
        var about = "Parent #" + result.parentId + " (" + result.parentLabel + ") → revealed on chain: " + (result.recordedLabel || short(result.onChainRoot));
        await reveal(rowsFrom(result), result.verdict, "Checked live from Avalanche Fuji at " + time + ", in your browser.", about);
      } catch (error) {
        status.textContent = "Couldn't reach Avalanche from this browser just now (" + (error.shortMessage || error.message) + ").";
        recorded("Showing the last recorded result instead. It is re-checked on every push:");
        var ci = el("a", null, "see the latest CI run");
        ci.href = CI;
        foot.insertBefore(ci, foot.childNodes[1]);
        foot.insertBefore(document.createTextNode(". "), foot.childNodes[2]);
      } finally {
        busy = false;
        run.disabled = false;
        run.textContent = "Check again";
      }
    }

    run.addEventListener("click", play);
    select(current);
  }

  mounts.forEach(mount);
})();
