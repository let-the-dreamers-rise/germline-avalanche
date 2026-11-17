/* Hero: the core transformation, played on load.
   Founder #1 breeds #2, which verifies GENUINE. Then #3 arrives claiming a
   higher score, and fails heredity: FORGED. All values are the real
   organisms on Avalanche Fuji. With no motion, the final state is the HTML. */
(function () {
  "use strict";
  var Site = window.Site || {};
  var hero = document.querySelector(".hero");
  if (!hero || !Site.motion || !Site.ready) return;
  Site.ready.then(start);

  function start() {
  var gsap = window.gsap;
  var OUT = "power3.out";
  var EASE = "power3.inOut";

  var title = hero.querySelector(".hero-title");
  var intro = gsap.timeline();
  if (Site.splitReveal) intro.add(Site.splitReveal(title, { immediate: true }), 0);
  intro.from(hero.querySelectorAll(".hero-copy .hero-in"), { autoAlpha: 0, y: 18, duration: 0.7, ease: OUT, stagger: 0.08 }, 0.25);
  intro.from(hero.querySelector(".hero-stage"), { autoAlpha: 0, y: 24, duration: 0.9, ease: OUT }, 0.35);

  var stage = hero.querySelector(".hero-stage");
  var q = function (s) { return stage.querySelector(s); };
  var org1 = q('[data-org="1"]'), org2 = q('[data-org="2"]'), org3 = q('[data-org="3"]');
  var link2 = q('[data-link="2"]'), link3 = q('[data-link="3"]');
  var hash = q(".hash");
  var replay = q(".replay");
  var glyphs = "0123456789abcdef";

  function counter(el) {
    var from = parseFloat(el.getAttribute("data-from") || el.getAttribute("data-score"));
    var to = parseFloat(el.getAttribute("data-score"));
    var s = { v: from };
    return gsap.fromTo(s, { v: from }, {
      v: to, duration: 1.1, ease: "power2.out",
      onStart: function () { el.textContent = String(from); },
      onUpdate: function () { el.textContent = String(Math.round(s.v)); }
    });
  }

  function scramble(el) {
    var finalHtml = el.innerHTML;
    var s = { p: 0 };
    return gsap.to(s, {
      p: 1, duration: 0.9, ease: "none",
      onUpdate: function () {
        if (s.p >= 1) { el.innerHTML = finalHtml; return; }
        var out = "0x";
        for (var i = 0; i < 8; i++) out += glyphs[(Math.random() * 16) | 0];
        el.textContent = out.slice(0, 6) + "…" + out.slice(6);
      },
      onComplete: function () { el.innerHTML = finalHtml; }
    });
  }

  function checks(org) { return org.querySelectorAll(".org-checks span"); }

  function build() {
    var tl = gsap.timeline({ paused: true, defaults: { ease: OUT } });
    tl.set([org2, org3, link2, link3], { autoAlpha: 0, y: 14 })
      .set([link2.querySelector(".link-line"), link3.querySelector(".link-line")], { scaleY: 0 })
      .set([checks(org2), checks(org3)], { autoAlpha: 0, x: -6 })
      .set([org2.querySelector(".chip"), org3.querySelector(".chip")], { autoAlpha: 0, scale: 0.6 })
      .call(function () { org3.classList.remove("org-forged"); });

    tl.from(org1, { autoAlpha: 0, y: 14, duration: 0.6 }, 0.2)
      .to(link2, { autoAlpha: 1, y: 0, duration: 0.4 }, ">")
      .to(link2.querySelector(".link-line"), { scaleY: 1, duration: 0.5, ease: EASE }, "<")
      .add(scramble(hash), "<0.1")
      .to(org2, { autoAlpha: 1, y: 0, duration: 0.6 }, ">-0.1")
      .add(counter(org2.querySelector(".org-score")), "<0.1")
      .to(checks(org2), { autoAlpha: 1, x: 0, duration: 0.3, stagger: 0.14 }, ">-0.4")
      .to(org2.querySelector(".chip"), { autoAlpha: 1, scale: 1, duration: 0.45, ease: "back.out(2)" }, ">")
      .to(link3, { autoAlpha: 1, y: 0, duration: 0.4 }, ">0.5")
      .to(link3.querySelector(".link-line"), { scaleY: 1, duration: 0.5, ease: EASE }, "<")
      .to(org3, { autoAlpha: 1, y: 0, duration: 0.6 }, ">-0.1")
      .add(counter(org3.querySelector(".org-score")), "<0.1");

    var c3 = checks(org3);
    tl.to([c3[1], c3[2], c3[3]], { autoAlpha: 1, x: 0, duration: 0.3, stagger: 0.14 }, ">-0.2")
      .to(c3[0], { autoAlpha: 1, x: 0, duration: 0.35 }, ">0.25")
      .call(function () { org3.classList.add("org-forged"); })
      .fromTo(org3, { x: 0 }, { x: 6, duration: 0.06, repeat: 5, yoyo: true, ease: "none" }, "<")
      .set(org3, { x: 0 })
      .to(org3.querySelector(".chip"), { autoAlpha: 1, scale: 1, duration: 0.5, ease: "back.out(2.4)" }, "<")
      .call(function () { if (replay) replay.hidden = false; });
    return tl;
  }

  var story = build();
  intro.add(function () { story.play(0); }, 0.9);

  if (replay) {
    replay.addEventListener("click", function () {
      replay.hidden = true;
      story.kill();
      gsap.set([org1, org2, org3, link2, link3], { clearProps: "all" });
      story = build();
      story.play(0);
    });
  }
  }
})();
