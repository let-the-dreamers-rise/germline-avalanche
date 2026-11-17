/* Landing scenes: the before/after slider, the pinned step-by-step stage with
   a scrubbed progress bar, and the closing CTA scale-up. */
(function () {
  "use strict";
  var Site = window.Site || {};
  var gsap = window.gsap;
  if (Site.motion && Site.ready) Site.ready.then(run); else run();

  function run() {

  // Before vs after. Works with keyboard (it is a range input) and without GSAP.
  var compare = document.querySelector(".compare");
  if (compare) {
    var range = compare.querySelector(".compare-range");
    var setPos = function (v) { compare.style.setProperty("--pos", v + "%"); };
    range.addEventListener("input", function () { setPos(range.value); });
    setPos(range.value);
    if (Site.motion) {
      var sweep = { v: 88 };
      gsap.to(sweep, {
        v: 50, duration: 1.4, ease: "power3.inOut",
        scrollTrigger: { trigger: compare, start: "top 70%", once: true },
        onStart: function () { setPos(88); },
        onUpdate: function () { range.value = Math.round(sweep.v); setPos(sweep.v); }
      });
    }
  }

  // Step-by-step stage.
  var steps = document.querySelector(".steps");
  if (steps) {
    var items = steps.querySelectorAll(".step");
    var screens = steps.querySelectorAll(".screen");
    var bar = steps.querySelector(".steps-progress span");
    var active = -1;
    var setActive = function (i) {
      if (i === active) return;
      active = i;
      items.forEach(function (it, k) { it.classList.toggle("is-active", k === i); });
      screens.forEach(function (s, k) {
        s.classList.toggle("is-active", k === i);
        s.setAttribute("aria-hidden", String(k !== i));
      });
    };
    setActive(0);
    items.forEach(function (it, k) {
      it.addEventListener("click", function () { setActive(k); });
    });

    if (Site.motion && window.ScrollTrigger) {
      var mm = gsap.matchMedia();
      mm.add("(min-width: 901px)", function () {
        var st = ScrollTrigger.create({
          trigger: steps,
          start: "top 18%",
          end: "+=" + items.length * 55 + "%",
          pin: true,
          scrub: true,
          onUpdate: function (self) {
            gsap.set(bar, { scaleY: self.progress });
            setActive(Math.min(items.length - 1, Math.floor(self.progress * items.length)));
          }
        });
        return function () { st.kill(); gsap.set(bar, { clearProps: "transform" }); };
      });
      mm.add("(max-width: 900px)", function () {
        screens.forEach(function (s) { s.removeAttribute("aria-hidden"); });
      });
    } else {
      screens.forEach(function (s) { s.removeAttribute("aria-hidden"); s.classList.add("is-active"); });
    }
  }

  // Closing CTA: scrubbed scale-up as it arrives.
  var closing = document.querySelector("[data-closing]");
  if (closing && Site.motion) {
    gsap.fromTo(closing, { scale: 0.92, autoAlpha: 0.4 }, {
      scale: 1, autoAlpha: 1, ease: "none",
      scrollTrigger: { trigger: closing, start: "top bottom", end: "top 40%", scrub: 0.6 }
    });
  }
  }
})();
