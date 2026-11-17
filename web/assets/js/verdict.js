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
        ["Parent match", true, "Re-breeding #1 with its seed gives exactly this child (0x454f…8eee)."],
        ["Fair seed", true, "The seed came from block 61187418, which did not exist when breeding was requested."],
        ["Score", true, "Claimed 38.2%. Re-measured: 38.2%."],
        ["Evidence", true, "The recorded evidence matches what was published."]
      ]
    },
    3: {
      name: "Forged child #3",
      revealed: "colour + size + ring + momentum",
      tx: "0xc5a19232d52a0152981d6ead72a460bae71f1e0532052a36574e3e8091a71223",
      verdict: "FORGED",
      checks: [
        ["Parent match", false, "Re-breeding #1 with its seed gives a different child (0xbe57…93b1), not the one recorded (0x253e…df5c). This child did not come from its parent."],
        ["Fair seed", true, "The seed came from block 61187439, which did not exist when breeding was requested."],
        ["Score", true, "Claimed 46.0%. Re-measured: 46.0%. A real score does not save a fake lineage."],
        ["Evidence", true, "The recorded evidence matches what was published."]
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

  // The bundle reads window.ethers as it loads, so ethers has to come first.
  function loadVerifier() {
    return (window.ethers ? Promise.resolve() : load(ETHERS)).then(function () { return load("live-bundle.js"); });
  }

  // Run the live check against the first RPC that answers.
  async function live(childId, say) {
    say("Loading the verifier…");
    await loadVerifier();
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

  var pct = function (bps) { return (Number(bps) / 100).toFixed(1) + "%"; };

  // Turn a live result into the four rows the machine shows, in plain words.
  function rowsFrom(r) {
    var rows = [[
      "Parent match", r.heredity,
      r.heredity
        ? "Re-breeding #" + r.parentId + " with its seed gives exactly this child (" + short(r.onChainRoot) + ")."
        : "Re-breeding #" + r.parentId + " with its seed gives a different child (" + short(r.derivedRoot) + "), not the one recorded (" + short(r.onChainRoot) + "). This child did not come from its parent."
    ]];
    rows.push(r.seed.checked
      ? ["Fair seed", r.seed.holds, r.seed.holds
          ? "The seed came from block " + r.seed.requestBlock + ", which did not exist when breeding was requested."
          : "The seed does not match block " + r.seed.requestBlock + ". Someone picked it."]
      : ["Fair seed", true, "Not re-derived here (no request transaction recorded)."]);
    rows.push(r.score.checked
      ? ["Score", r.score.holds, "Claimed " + pct(r.score.attestedBps) + ". Re-measured in your browser: " + pct(r.score.measuredBps) + "." +
          (r.score.holds && !r.heredity ? " A real score does not save a fake lineage." : "")]
      : ["Score", true, r.score.attested ? "Claimed " + pct(r.score.attestedBps) + ", not re-measurable here." : "No score claimed yet."]);
    rows.push(r.score.checked
      ? ["Evidence", r.score.evidenceHolds, r.score.evidenceHolds ? "The recorded evidence matches what your browser re-measured." : "The recorded evidence does not match."]
      : ["Evidence", true, "Not checked."]);
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
    var run = el("button", "btn btn-primary vm-run", "Check it live");
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

    function draw(rows, verdict, source) {
      var c = CHILDREN[current];
      Object.keys(buttons).forEach(function (k) { buttons[k].setAttribute("aria-pressed", String(Number(k) === current)); });
      meta.textContent = "Parent #1 (31.5%) → this child: " + c.revealed;
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
      var a = el("a", null, "See it on the blockchain explorer");
      a.href = TX + c.tx;
      foot.appendChild(a);
      foot.appendChild(document.createTextNode(" · developers can re-run it with "));
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
    function reveal(rows, verdict, source) {
      var pending = rows.map(function (r) { return [r[0], null, "waiting"]; });
      draw(pending, null, source);
      var step = window.Site && window.Site.reduce ? 0 : 420;
      var i = 0;
      return new Promise(function (resolve) {
        (function next() {
          if (i >= rows.length) { draw(rows, verdict, source); resolve(); return; }
          pending[i] = rows[i];
          draw(pending, null, source);
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
        await reveal(rowsFrom(result), result.verdict, "Checked live from Avalanche Fuji at " + time + ", in your browser.");
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

    // Fetch the verifier as soon as it is about to be seen, so pressing the
    // button only waits for the chain, not for a download.
    var warm = function () { loadVerifier().catch(function () {}); };
    if ("IntersectionObserver" in window) {
      var seen = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { seen.disconnect(); warm(); }
      }, { rootMargin: "400px 0px" });
      seen.observe(host);
    }
    run.addEventListener("pointerenter", warm, { once: true });
    run.addEventListener("focus", warm, { once: true });
  }

  mounts.forEach(mount);
})();
