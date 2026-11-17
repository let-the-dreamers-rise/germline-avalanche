/* Shared behaviour for every page: navigation, copy buttons, pausing loops
   offscreen, and the motion layer (masked headline reveals, staggered
   fade-ups, count-ups, cursor parallax, footer wordmark). Everything here is
   progressive: with no GSAP, no JS or reduced motion, the page is complete. */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasGsap = typeof window.gsap !== "undefined";
  var Site = (window.Site = { reduce: reduce, motion: hasGsap && !reduce });

  // Navigation toggle on small screens.
  var toggle = document.querySelector(".nav-toggle");
  var links = document.getElementById("nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  // Copy buttons: any element with data-copy copies that text.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
  }
  document.querySelectorAll("[data-copy]").forEach(function (el) {
    el.addEventListener("click", function () {
      var label = el.querySelector(".copy-label") || el;
      var before = label.textContent;
      copyText(el.getAttribute("data-copy")).then(
        function () { el.classList.add("copied"); label.textContent = "Copied"; },
        function () { label.textContent = "Select and copy"; }
      ).then(function () {
        setTimeout(function () { el.classList.remove("copied"); label.textContent = before; }, 1800);
      });
    });
  });

  // Pause anything that loops while it is offscreen.
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        e.target.classList.toggle("paused", !e.isIntersecting);
        e.target.dispatchEvent(new CustomEvent(e.isIntersecting ? "loop:play" : "loop:pause"));
      });
    }, { rootMargin: "80px" });
    document.querySelectorAll(".cmd, .marquee, [data-loop]").forEach(function (el) { io.observe(el); });
  }

  if (!Site.motion) {
    root.classList.add("no-motion");
    return;
  }

  var gsap = window.gsap;
  var plugins = [window.ScrollTrigger, window.SplitText].filter(Boolean);
  gsap.registerPlugin.apply(gsap, plugins);
  var EASE = "power3.inOut";
  var OUT = "power3.out";
  Site.EASE = EASE;
  Site.OUT = OUT;

  // Split lines only once the web fonts are in, or the line breaks are wrong.
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  var timeout = new Promise(function (resolve) { setTimeout(resolve, 1500); });
  Site.ready = Promise.race([fontsReady, timeout]).then(function () { init(); return Site; });

  function init() {

  // Masked line reveals on every headline marked data-split.
  Site.splitReveal = function (el, opts) {
    opts = opts || {};
    if (!window.SplitText) return gsap.from(el, { autoAlpha: 0, y: 24, duration: 0.8, ease: OUT });
    var split = SplitText.create(el, { type: "lines", mask: "lines", linesClass: "split-line-inner" });
    var vars = { yPercent: 110, duration: 0.9, ease: OUT, stagger: 0.08, delay: opts.delay || 0 };
    if (!opts.immediate) vars.scrollTrigger = { trigger: el, start: "top 86%", once: true };
    return gsap.from(split.lines, vars);
  };
  document.querySelectorAll("[data-split]").forEach(function (el) {
    if (!el.closest(".hero")) Site.splitReveal(el);
  });

  // Staggered fade-up for content as it enters.
  document.querySelectorAll("[data-reveal]").forEach(function (group) {
    var items = group.hasAttribute("data-stagger") ? group.children : [group];
    // Opacity only, never visibility: content not yet revealed must stay
    // reachable by keyboard and screen readers.
    gsap.from(items, {
      opacity: 0, y: 28, duration: 0.8, ease: OUT, stagger: 0.09,
      scrollTrigger: { trigger: group, start: "top 88%", once: true }
    });
  });

  // Count-ups. The final number is already in the HTML.
  document.querySelectorAll("[data-count]").forEach(function (el) {
    var end = parseFloat(el.getAttribute("data-count"));
    var decimals = (el.getAttribute("data-count").split(".")[1] || "").length;
    var from = parseFloat(el.getAttribute("data-from") || "0");
    var state = { v: from };
    var fmt = function (v) { return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }); };
    el.textContent = fmt(from);
    gsap.to(state, {
      v: end, duration: 1.6, ease: "power2.out",
      scrollTrigger: { trigger: el, start: "top 90%", once: true },
      onUpdate: function () { el.textContent = fmt(state.v); }
    });
  });

  // Cursor-reactive parallax: children with data-depth drift with the pointer.
  if (window.matchMedia("(pointer: fine)").matches) {
    document.querySelectorAll("[data-parallax]").forEach(function (zone) {
      var layers = Array.prototype.map.call(zone.querySelectorAll("[data-depth]"), function (layer) {
        var depth = parseFloat(layer.getAttribute("data-depth"));
        return {
          x: gsap.quickTo(layer, "x", { duration: 0.8, ease: "power3.out" }),
          y: gsap.quickTo(layer, "y", { duration: 0.8, ease: "power3.out" }),
          d: depth
        };
      });
      zone.addEventListener("pointermove", function (e) {
        var r = zone.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width - 0.5;
        var ny = (e.clientY - r.top) / r.height - 0.5;
        layers.forEach(function (l) { l.x(nx * l.d); l.y(ny * l.d); });
      });
      zone.addEventListener("pointerleave", function () {
        layers.forEach(function (l) { l.x(0); l.y(0); });
      });
    });
  }

  // Footer wordmark: letters rise into place as the page ends.
  document.querySelectorAll(".wordmark").forEach(function (mark) {
    gsap.from(mark.children, {
      yPercent: 60, autoAlpha: 0, ease: "none", stagger: 0.05,
      scrollTrigger: { trigger: mark, start: "top bottom", end: "bottom bottom", scrub: 0.6 }
    });
  });

  root.classList.add("motion-ready");
  if (window.ScrollTrigger) ScrollTrigger.refresh();
  }
})();
