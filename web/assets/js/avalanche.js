/* Avalanche page: the TX 2 block hash resolves out of noise as it scrolls in,
   which is the commit-reveal in one gesture. */
(function () {
  "use strict";
  var Site = window.Site || {};
  var target = document.querySelector("[data-resolve]");
  if (!target || !Site.motion || !Site.ready) return;
  Site.ready.then(function () {
    var finalText = target.textContent;
    var hex = "0123456789abcdef";
    var s = { p: 0 };
    window.gsap.to(s, {
      p: 1, duration: 1.2, ease: "none",
      scrollTrigger: { trigger: target, start: "top 80%", once: true },
      onUpdate: function () {
        if (s.p >= 1) { target.textContent = finalText; return; }
        var out = "0x";
        for (var i = 0; i < 12; i++) out += hex[(Math.random() * 16) | 0];
        target.textContent = out.slice(0, 10) + "…" + out.slice(10);
      },
      onComplete: function () { target.textContent = finalText; }
    });
  });
})();
