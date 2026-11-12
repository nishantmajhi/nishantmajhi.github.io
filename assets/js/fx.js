/*
 * Page effects for the home page: scroll reveals, count-up numbers, the
 * spotlight that follows the pointer over cards, the terminal tilt, the scroll
 * progress bar and the Index filter. Everything here is decoration on top of a
 * page that already works without it.
 */
(function () {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  /* ----------------------------------------------------- scroll reveals --- */
  const revealAll = () => document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("in"));
  if (reduced || !("IntersectionObserver" in window)) {
    revealAll();
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        // stagger the ones that arrive together, e.g. a row of cards
        let n = 0;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.style.setProperty("--rd", `${Math.min(n++, 6) * 80}ms`);
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
  }

  /* ------------------------------------------------------- count-ups --- */
  function countUp(el, target) {
    if (reduced || !Number.isFinite(target)) {
      el.textContent = target;
      return;
    }
    el.dataset.counting = "1";
    el.dataset.target = String(target);
    const start = performance.now();
    const dur = 1100;
    (function frame(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(target * eased);
      if (t < 1) requestAnimationFrame(frame);
      else delete el.dataset.counting;
    })(start);
  }

  document.querySelectorAll("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count);
    el.textContent = "0";
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        countUp(el, target);
        io.disconnect();
      }
    });
    io.observe(el);
  });

  // repo-index.js fills these in once GitHub answers; animate when it does.
  ["repo-count", "lang-count"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(() => {
      if (el.dataset.counting) return;
      const n = Number(el.textContent);
      if (String(n) === el.dataset.target) return; // our own last frame
      if (Number.isFinite(n) && n > 0) countUp(el, n);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });

  /* ------------------------------------------------------- spotlight --- */
  if (finePointer) {
    document.addEventListener(
      "pointermove",
      (e) => {
        const el = e.target.closest && e.target.closest(".card, .stat, .lang-group");
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
      },
      { passive: true },
    );

    const term = document.querySelector(".term");
    if (term && !reduced) {
      term.addEventListener("pointermove", (e) => {
        const r = term.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        term.style.setProperty("--ry", `${x * 8}deg`);
        term.style.setProperty("--rx", `${-y * 8}deg`);
      });
      term.addEventListener("pointerleave", () => {
        term.style.setProperty("--ry", "0deg");
        term.style.setProperty("--rx", "0deg");
      });
    }
  }

  /* ------------------------------------------------- scroll progress --- */
  const bar = document.querySelector(".progress");
  if (bar) {
    let queued = false;
    const update = () => {
      queued = false;
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.setProperty("--p", max > 0 ? Math.min(1, scrollY / max) : 0);
    };
    addEventListener(
      "scroll",
      () => {
        if (!queued) {
          queued = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    update();
  }

  /* ---------------------------------------------------- Index filter --- */
  const input = document.getElementById("repo-filter");
  const empty = document.getElementById("filter-empty");
  if (input) {
    const apply = () => {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      document.querySelectorAll("#repo-list .lang-group").forEach((group) => {
        const heading = group.querySelector("h4");
        const headingHit = !q || (heading && heading.textContent.toLowerCase().includes(q));
        let groupShown = 0;
        let sub = null;
        let subShown = 0;
        const closeSub = () => {
          if (sub) sub.hidden = subShown === 0;
        };
        for (const child of group.children) {
          if (child.classList.contains("index-sub")) {
            closeSub();
            sub = child;
            subShown = 0;
          } else if (child.classList.contains("index-row")) {
            const subHit = sub && q && sub.textContent.toLowerCase().includes(q);
            const hit = headingHit || subHit || child.textContent.toLowerCase().includes(q);
            child.hidden = !hit;
            if (hit) {
              groupShown++;
              subShown++;
            }
          }
        }
        closeSub();
        group.hidden = groupShown === 0;
        shown += groupShown;
      });
      if (empty) empty.hidden = shown > 0 || !q;
      layoutIndex();
    };
    input.addEventListener("input", apply);
  }

  /* ------------------------------------------------ Index two columns --- */
  /*
   * CSS columns cannot end both columns at the same height, so once the list
   * has loaded the groups are split, in order, into two flex columns at the
   * point where the heights come closest, and the last group in each column
   * stretches so that both columns finish on the same line.
   */
  const list = document.getElementById("repo-list");
  let groups = null; // in the order repo-index.js drew them
  let cols = null;
  const twoColumns = window.matchMedia("(min-width: 641px)");

  function layoutIndex() {
    if (!groups) return;
    const visible = groups.filter((g) => !g.hidden);
    for (const g of groups) g.style.flexGrow = "";

    if (!twoColumns.matches) {
      for (const g of groups) cols[0].appendChild(g);
      return;
    }

    // natural heights, measured while nothing is stretched
    const h = visible.map((g) => g.getBoundingClientRect().height);
    const total = h.reduce((a, b) => a + b, 0);
    let best = visible.length, bestDiff = Infinity, run = 0;
    for (let k = 1; k <= visible.length; k++) {
      run += h[k - 1];
      const diff = Math.abs(run - (total - run));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = k;
      }
    }
    const firstRight = visible[best]; // undefined: everything goes left
    let target = cols[0];
    for (const g of groups) {
      if (g === firstRight) target = cols[1];
      target.appendChild(g);
    }
    for (const col of cols) {
      const shown = [...col.children].filter((g) => !g.hidden);
      if (shown.length) shown[shown.length - 1].style.flexGrow = "1";
    }
  }

  function setUpIndex() {
    groups = [...list.querySelectorAll(".lang-group")];
    if (!groups.length) return;
    const wrap = document.createElement("div");
    wrap.className = "repo-cols";
    cols = [document.createElement("div"), document.createElement("div")];
    for (const c of cols) {
      c.className = "repo-col";
      wrap.appendChild(c);
    }
    list.appendChild(wrap);
    list.classList.add("laid");
    for (const g of groups) cols[0].appendChild(g);
    layoutIndex();
  }

  if (list) {
    const ready = () => !document.getElementById("loading-msg") && list.querySelector(".lang-group");
    if (ready()) setUpIndex();
    else {
      const mo = new MutationObserver(() => {
        if (ready()) {
          mo.disconnect();
          setUpIndex();
        }
      });
      mo.observe(list, { childList: true });
    }
    let t = 0;
    addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(layoutIndex, 150);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutIndex);
  }
})();
