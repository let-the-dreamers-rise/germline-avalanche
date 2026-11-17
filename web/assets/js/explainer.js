/* The twenty-second sequence: six scenes on one GSAP timeline, a progress
   line across the top, and a replay button at the end. */
(function () {
  "use strict";
  var Site = window.Site || {};
  var stage = document.getElementById("stage");
  if (!stage || !Site.motion || !Site.ready) return;

  Site.ready.then(function () {
    var gsap = window.gsap;
    var scenes = stage.querySelectorAll(".ex-scene");
    var bar = stage.querySelector(".ex-progress span");
    var replay = stage.querySelector(".ex-replay");
    var q = function (n, sel) { return scenes[n - 1].querySelectorAll(sel); };

    function count(el, to, dur) {
      var s = { v: 0 };
      return gsap.to(s, { v: to, duration: dur, ease: "power2.out", onUpdate: function () { el.textContent = Math.round(s.v).toLocaleString("en-US"); } });
    }
    function show(n) { return gsap.fromTo(scenes[n - 1], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.5, ease: "power3.out" }); }
    function hide(n) { return gsap.to(scenes[n - 1], { autoAlpha: 0, y: -16, duration: 0.45, ease: "power3.in" }); }
    function words(n) {
      var h = scenes[n - 1].querySelector("h1");
      if (!h) return gsap.timeline();
      if (!h._split && window.SplitText) h._split = SplitText.create(h, { type: "words", mask: "words" });
      return gsap.from(h._split ? h._split.words : h, { yPercent: 110, duration: 0.7, ease: "power3.out", stagger: 0.06 });
    }

    function build() {
      gsap.set(scenes, { autoAlpha: 0, y: 0 });
      var tl = gsap.timeline();
      tl.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: 21, ease: "none" }, 0);

      tl.add(show(1), 0.2).add(words(1), 0.2)
        .from(q(1, ".knobs i"), { scale: 0, autoAlpha: 0, duration: 0.4, ease: "back.out(2)", stagger: { each: 0.04, from: "random" } }, 0.7)
        .add(hide(1), 3.3);

      tl.add(show(2), 3.8).add(words(2), 3.8)
        .from(q(2, ".knobs i.on"), { scale: 1.6, duration: 0.5, ease: "back.out(3)", stagger: 0.12 }, 4.3)
        .from(q(2, "p"), { autoAlpha: 0, y: 14, duration: 0.6, ease: "power3.out" }, 4.9)
        .add(hide(2), 7.2);

      var big = scenes[2].querySelector("[data-ex-count]");
      tl.add(show(3), 7.7)
        .from(q(3, "p:not(.ex-big)"), { autoAlpha: 0, y: 12, duration: 0.5, stagger: 1.4 }, 7.8)
        .add(count(big, 3486784401, 1.8), 8.1)
        .add(hide(3), 10.6);

      var score = scenes[3].querySelector("[data-ex-score]");
      tl.add(show(4), 11.1).add(words(4), 11.1)
        .from(q(4, "p"), { autoAlpha: 0, y: 12, duration: 0.5, stagger: 0.4 }, 11.6)
        .fromTo(q(4, ".ex-bar span"), { scaleX: 0.34 }, { scaleX: 0.89, duration: 2.2, ease: "power3.inOut" }, 12.3)
        .add(gsap.fromTo({ v: 3148 }, { v: 3148 }, { v: 4765, duration: 2.2, ease: "power3.inOut", onUpdate: function () { score.textContent = (this.targets()[0].v / 100).toFixed(1) + "%"; } }), 12.3)
        .add(hide(4), 15);

      tl.add(show(5), 15.5).add(words(5), 15.5)
        .from(q(5, ".stamp.genuine"), { scale: 1.8, autoAlpha: 0, duration: 0.45, ease: "back.out(2)" }, 16.2)
        .from(q(5, ".stamp.forged"), { scale: 1.8, autoAlpha: 0, duration: 0.45, ease: "back.out(2)" }, 17.2)
        .from(q(5, ".ex-mono"), { autoAlpha: 0, y: 12, duration: 0.6 }, 17.8)
        .add(hide(5), 19.6);

      tl.add(show(6), 20.1).add(words(6), 20.1)
        .from(q(6, ".cta-row"), { autoAlpha: 0, y: 14, duration: 0.6 }, 20.6)
        .call(function () { replay.hidden = false; });
      return tl;
    }

    var tl = build();
    replay.addEventListener("click", function () {
      replay.hidden = true;
      tl.kill();
      tl = build();
    });
  });
})();
