/* The verdict machine: run verify.js's four checks on the two real children
   recorded on Avalanche Fuji. Every value below is copied from the live
   verify.js output for contract 0xA0448Cd63f746a60447cfF1817ec9781C25F7b25. */
(function () {
  "use strict";
  var mounts = document.querySelectorAll("[data-verdict-machine]");
  if (!mounts.length) return;

  var TX = "https://testnet.snowtrace.io/tx/";
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
        ["Parent match", false, "Re-breeding #1 with its seed gives a different child (0xbe57…93b1), not the one recorded (0x253e…5f5c). This child did not come from its parent."],
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

  function mount(host) {
    var current = 3;
    var running = null;
    var wrap = el("div", "vm");
    var head = el("div", "vm-head");
    var picker = el("div", "vm-pick");
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "Choose a child to verify");
    var buttons = {};
    [2, 3].forEach(function (id) {
      var b = el("button", "vm-tab", CHILDREN[id].name);
      b.type = "button";
      b.addEventListener("click", function () { select(id); });
      buttons[id] = b;
      picker.appendChild(b);
    });
    var run = el("button", "btn btn-primary vm-run", "Check it");
    run.type = "button";
    head.appendChild(picker);
    head.appendChild(run);

    var body = el("div", "vm-body");
    var meta = el("p", "vm-meta");
    var list = el("ol", "vm-checks");
    var stamp = el("div", "vm-stamp");
    stamp.setAttribute("aria-live", "polite");
    body.appendChild(meta);
    body.appendChild(list);
    body.appendChild(stamp);

    var foot = el("p", "vm-foot");
    wrap.appendChild(head);
    wrap.appendChild(body);
    wrap.appendChild(foot);
    host.appendChild(wrap);

    function render(final) {
      var c = CHILDREN[current];
      Object.keys(buttons).forEach(function (k) { buttons[k].setAttribute("aria-pressed", String(Number(k) === current)); });
      meta.textContent = "Parent #1 (31.5%) → this child: " + c.revealed;
      list.innerHTML = "";
      c.checks.forEach(function (chk) {
        var li = el("li", "vm-check" + (final ? (chk[1] ? " pass" : " fail") : ""));
        var mark = el("span", "vm-mark", final ? (chk[1] ? "✓" : "✗") : "•");
        mark.setAttribute("aria-hidden", "true");
        var label = el("span", "vm-label", chk[0]);
        var detail = el("span", "vm-detail", final ? chk[2] : "waiting");
        var state = el("span", "visually-hidden", final ? (chk[1] ? " verified" : " failed") : "");
        li.appendChild(mark); li.appendChild(label); li.appendChild(state); li.appendChild(detail);
        list.appendChild(li);
      });
      stamp.className = "vm-stamp" + (final ? " show " + c.verdict.toLowerCase() : "");
      stamp.textContent = final ? "VERDICT: " + c.verdict : "";
      foot.innerHTML = "";
      var a = el("a", null, "See it on the blockchain explorer");
      a.href = TX + c.tx;
      foot.appendChild(a);
      foot.appendChild(document.createTextNode(" · developers can re-run it with "));
      foot.appendChild(el("code", null, "npm run recheck:fuji"));
    }

    function select(id) {
      if (running) { clearTimeout(running); running = null; }
      current = id;
      render(false);
    }

    function play() {
      if (running) { clearTimeout(running); running = null; }
      render(false);
      var c = CHILDREN[current];
      var rows = list.children;
      var reduce = window.Site && window.Site.reduce;
      var step = reduce ? 0 : 520;
      var i = 0;
      run.disabled = true;
      function next() {
        if (i > 0) {
          var prev = rows[i - 1], chk = c.checks[i - 1];
          prev.className = "vm-check " + (chk[1] ? "pass" : "fail");
          prev.querySelector(".vm-mark").textContent = chk[1] ? "✓" : "✗";
          prev.querySelector(".vm-detail").textContent = chk[2];
          prev.querySelector(".visually-hidden").textContent = chk[1] ? " verified" : " failed";
        }
        if (i < rows.length) {
          rows[i].className = "vm-check running";
          rows[i].querySelector(".vm-detail").textContent = "checking…";
          i++;
          running = setTimeout(next, step);
        } else {
          stamp.textContent = "VERDICT: " + c.verdict;
          stamp.className = "vm-stamp show " + c.verdict.toLowerCase();
          run.disabled = false;
          running = null;
        }
      }
      next();
    }

    run.addEventListener("click", play);
    render(true);
  }

  mounts.forEach(mount);
})();
