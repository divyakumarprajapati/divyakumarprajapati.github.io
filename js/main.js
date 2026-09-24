/*
 * Page behaviour. The intro is a pinned stage: scrolling zooms the current
 * world and opens the next one inside a growing lens. Everything else is
 * small: reveals, counters, the Bangalore clock, captions and the timeline glow.
 */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduce = root.classList.contains('reduce');
  const $ = (sel, scope = document) => scope.querySelector(sel);
  const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);

  /* years of experience, counted from June 2021 */
  const start = new Date(2021, 5, 1);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  if (now.getMonth() < start.getMonth()) years -= 1;
  $$('[data-years]').forEach((el) => { el.textContent = `${years}+`; });
  $$('[data-year]').forEach((el) => { el.textContent = String(now.getFullYear()); });
  const yearsCount = $('[data-count="5"]');
  if (yearsCount) yearsCount.dataset.count = String(years);

  /* nav gets solid once the page moves */
  const nav = $('[data-nav]');
  const onNav = () => nav.classList.toggle('is-scrolled', window.scrollY > 24);
  onNav();
  window.addEventListener('scroll', onNav, { passive: true });

  /* stars: one element, many shadows */
  $$('[data-stars]').forEach((el, k) => {
    let s = 4711 + k * 131;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const dots = [];
    for (let i = 0; i < 160; i++) {
      const big = rnd() < 0.1;
      dots.push(`${(rnd() * 100).toFixed(2)}vw ${(rnd() * 56).toFixed(2)}vh 0 ${big ? 1 : 0}px rgba(255, 244, 230, ${(0.25 + rnd() * 0.7).toFixed(2)})`);
    }
    el.style.boxShadow = dots.join(',');
  });

  /* Vulrend scene: a wall of generated ads */
  const wall = $('[data-adwall]');
  if (wall) {
    const ICON = {
      tee: '<path d="M31 20L41 15Q50 23 59 15L69 20L93 35L84 52L74 46V92H26V46L16 52L7 35Z" fill="#fbfaf6" stroke="rgba(0,0,0,.18)" stroke-width="1.5" stroke-linejoin="round"/>',
      bottle: '<rect x="42" y="8" width="16" height="14" rx="3" fill="#2b2327"/><rect x="45" y="21" width="10" height="7" fill="#e6d6dd"/><rect x="30" y="27" width="40" height="68" rx="12" fill="#fff" stroke="rgba(0,0,0,.15)" stroke-width="1.5"/><path d="M40 58h20M40 65h13" stroke="#c98ea2" stroke-width="3" stroke-linecap="round"/>',
      shoe: '<path d="M8 66Q10 50 22 48L40 46Q48 36 58 42L74 54Q92 58 94 68V76H8Z" fill="#fff" stroke="rgba(0,0,0,.2)" stroke-width="1.5"/><path d="M8 76h86" stroke="rgba(0,0,0,.35)" stroke-width="5"/><path d="M44 50l6 6M50 46l6 6" stroke="rgba(0,0,0,.25)" stroke-width="2"/>',
      cup: '<path d="M24 36h44v32a14 14 0 0 1-14 14H38a14 14 0 0 1-14-14z" fill="#fff" stroke="rgba(0,0,0,.2)" stroke-width="1.5"/><path d="M68 44h6a9 9 0 0 1 0 18h-6" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="4"/><path d="M38 20q4 6 0 11M50 18q4 7 0 13" stroke="rgba(0,0,0,.28)" stroke-width="3" fill="none" stroke-linecap="round"/>',
      headphones: '<path d="M22 62V50a28 28 0 0 1 56 0v12" fill="none" stroke="#f6f0ea" stroke-width="6" stroke-linecap="round"/><rect x="14" y="56" width="18" height="30" rx="8" fill="#f6f0ea"/><rect x="68" y="56" width="18" height="30" rx="8" fill="#f6f0ea"/>',
      watch: '<rect x="40" y="6" width="20" height="88" rx="6" fill="rgba(0,0,0,.28)"/><circle cx="50" cy="50" r="23" fill="#fff" stroke="rgba(0,0,0,.25)" stroke-width="3"/><path d="M50 37v13l8 6" stroke="rgba(0,0,0,.55)" stroke-width="3" fill="none" stroke-linecap="round"/>',
    };
    const ADS = [
      ['New drop', 'Meet the newest addition', 'tee', 'peach'],
      ['Showcase', 'Made to last', 'shoe', 'sage'],
      ['Offer', '20% off this week', 'bottle', 'lilac'],
      ['Seasonal', 'Fresh roast is back', 'cup', 'butter'],
      ['Launch', 'Sound, simplified', 'headphones', 'ink'],
      ['Comparison', 'Built for every day', 'watch', 'sky'],
      ['Social proof', 'Loved by 10k buyers', 'bottle', 'coral'],
    ];
    const tiles = [];
    for (let i = 0; i < 21; i++) {
      const [kind, line, icon, tone] = ADS[(i * 3 + Math.floor(i / 7)) % ADS.length];
      tiles.push(`<div class="ad ad--${tone}"><span class="ad__k">${kind}</span><span class="ad__t">${line}</span><svg viewBox="0 0 100 100">${ICON[icon]}</svg><span class="ad__cta">Shop now</span></div>`);
    }
    wall.innerHTML = tiles.join('');
  }

  /* the intro: a short story, told by zooming through a lens into each world */
  const intro = $('[data-intro]');
  if (intro) {
    const scenes = $$('[data-scene]', intro);
    const bgs = scenes.map((s) => $('[data-scene-bg]', s));
    const texts = scenes.map((s) => $('[data-scene-text]', s));
    const feeds = scenes.map((s) => $('[data-feed]', s));
    const ring = $('[data-ring]', intro);
    const hudCount = $('[data-hud-count]', intro);
    const hudName = $('[data-hud-name]', intro);
    const hudBar = $('[data-hud-bar]', intro);
    const cue = $('[data-scroll-cue]', intro);
    const N = scenes.length;
    const TAIL = 0.45; // how long the last world holds before the page moves on
    const pad = (n) => String(n).padStart(2, '0');

    // The story so far: the constellation is laid out in pixels for the current
    // screen, so labels never collide and the line can draw itself cleanly.
    const journey = scenes.find((s) => s.classList.contains('scene--journey'));
    const jr = journey && {
      box: $('.journey', journey),
      svg: $('.journey__lines', journey),
      track: $('.journey__track', journey),
      path: $('.journey__path', journey),
      stars: $$('.jstar', journey),
      len: 0,
      draw: reduce ? 1 : 0,
    };
    const drawJourney = (draw) => {
      if (!jr) return;
      jr.draw = draw;
      journey.style.setProperty('--draw', draw.toFixed(3));
      jr.path.style.strokeDashoffset = (jr.len * (1 - draw)).toFixed(1);
    };
    const layoutJourney = () => {
      if (!jr) return;
      const W = jr.box.offsetWidth;
      const H = jr.box.offsetHeight;
      const n = jr.stars.length;
      const labels = jr.stars.map((st) => $('.jstar__label', st));
      const tallest = () => Math.max(...labels.map((l) => l.offsetHeight));
      jr.box.classList.remove('is-compact');
      let lh = tallest();
      const pts = [];
      jr.stars.forEach((st) => st.classList.remove('is-above', 'is-below', 'is-side'));
      if (W < 620) {
        // phones: a straight path up the left side, labels beside each star;
        // on short screens each label collapses to a single line
        if ((H - lh - 20) / (n - 1) < lh + 6) { jr.box.classList.add('is-compact'); lh = tallest(); }
        const pad = lh / 2 + 10;
        for (let k = 0; k < n; k++) pts.push([14, H - pad - (k * (H - 2 * pad)) / (n - 1)]);
        jr.stars.forEach((st) => st.classList.add('is-side'));
      } else {
        // wider screens: a gentle climb, labels alternating above and below the line;
        // on short windows each label collapses to a single line
        if (H < 2 * (lh + 24) + 8) { jr.box.classList.add('is-compact'); lh = tallest(); }
        const ws = labels.map((l) => l.offsetWidth);
        const x0 = ws[0] / 2 + 6;
        const x1 = W - ws[n - 1] / 2 - 6;
        const rise = clamp(Math.min(H - 2 * (lh + 24), 0.15 * (x1 - x0)), 0, 420);
        for (let k = 0; k < n; k++) pts.push([x0 + (k * (x1 - x0)) / (n - 1), H / 2 + rise / 2 - (k * rise) / (n - 1)]);
        jr.stars.forEach((st, k) => st.classList.add(k % 2 ? 'is-above' : 'is-below'));
      }
      jr.stars.forEach((st, k) => {
        st.style.left = `${pts[k][0].toFixed(1)}px`;
        st.style.top = `${pts[k][1].toFixed(1)}px`;
      });
      const d = pts.map((pt, k) => `${k ? 'L' : 'M'}${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ');
      jr.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      jr.track.setAttribute('d', d);
      jr.path.setAttribute('d', d);
      jr.len = jr.path.getTotalLength();
      jr.path.style.strokeDasharray = `${jr.len.toFixed(1)} ${jr.len.toFixed(1)}`;
      drawJourney(jr.draw);
    };

    // Each visual starts just below its words, measured from layout (not transforms),
    // so text and animation never overlap whatever the screen size.
    const layout = () => {
      scenes.forEach((scene, i) => {
        const block = texts[i].firstElementChild;
        const bottom = block.offsetTop + block.offsetHeight;
        scene.style.setProperty('--safe-top', `${Math.round(bottom + 22)}px`);
      });
      layoutJourney();
    };
    layout();
    window.addEventListener('resize', layout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

    if (reduce) {
      feeds.forEach((f) => { if (f) f.dataset.idle = '0'; });
    } else {
      let queued = false;
      const span = () => intro.offsetHeight - window.innerHeight;

      const update = () => {
        queued = false;
        const p = clamp(-intro.getBoundingClientRect().top / span(), 0, 1);
        const pos = p * (N - 1 + TAIL);
        const R = Math.hypot(window.innerWidth, window.innerHeight) / 2 + 40;

        // how far each world's lens has opened (the first world is the base layer)
        const open = scenes.map((_, i) => (i === 0 ? 1 : smooth(clamp((pos - (i - 1) - 0.42) / 0.58, 0, 1))));
        let current = 0;
        open.forEach((o, i) => { if (o > 0.5) current = i; });

        scenes.forEach((scene, i) => {
          const o = open[i];
          const next = i + 1 < N ? open[i + 1] : 0;
          const hidden = (i > 0 && o <= 0) || next >= 1;
          scene.style.visibility = hidden ? 'hidden' : 'visible';
          scene.setAttribute('aria-hidden', String(i !== current));
          if (i > 0) scene.style.clipPath = o >= 1 ? 'none' : `circle(${(o * R).toFixed(1)}px at 50% 50%)`;

          // a new world arrives slightly magnified and settles; the old one rushes past
          const drift = clamp(pos - i, 0, 1);
          const zoom = (i > 0 ? 1.2 - 0.2 * o : 1) + 0.04 * drift + 1.1 * next * next;
          bgs[i].style.transform = `scale(${zoom.toFixed(4)})`;
          bgs[i].style.filter = next > 0 ? `brightness(${(1 - 0.5 * next).toFixed(3)})` : '';

          // words come in once the lens is mostly open and leave as the next one starts
          const tIn = i === 0 ? 1 : clamp((o - 0.5) / 0.4, 0, 1);
          const tOut = clamp(next / 0.3, 0, 1);
          const a = tIn * (1 - tOut);
          const t = texts[i];
          t.style.opacity = a.toFixed(3);
          t.style.transform = `translateY(${((1 - tIn) * 28 - tOut * 28).toFixed(1)}px) scale(${(1 + tOut * 0.1).toFixed(3)})`;
          t.style.filter = a < 0.999 ? `blur(${((1 - a) * 10).toFixed(1)}px)` : 'none';

          // the story so far: the constellation draws itself while you read it
          if (scene === journey) drawJourney(smooth(clamp((pos - (i - 1) - 0.72) / 0.62, 0, 1)));

          if (feeds[i]) feeds[i].dataset.idle = hidden ? '1' : '0';
        });

        // the glowing rim rides the edge of whichever lens is opening
        let rim = 0, rimR = 0;
        for (let i = 1; i < N; i++) {
          if (open[i] > 0 && open[i] < 1) { rim = Math.sin(open[i] * Math.PI); rimR = open[i] * R; }
        }
        ring.style.opacity = rim.toFixed(3);
        ring.style.width = ring.style.height = `${(rimR * 2).toFixed(1)}px`;

        hudCount.textContent = `${pad(current + 1)} / ${pad(N)}`;
        hudName.textContent = scenes[current].dataset.scene;
        hudBar.style.width = `${(p * 100).toFixed(1)}%`;
        if (cue) cue.style.opacity = String(clamp(1 - pos * 4, 0, 1));
      };

      // "Scroll for my story" glides to the next chapter instead of skipping the story
      if (cue) {
        cue.addEventListener('click', (e) => {
          e.preventDefault();
          const top = intro.getBoundingClientRect().top + window.scrollY;
          window.scrollTo({ top: top + span() * (1.12 / (N - 1 + TAIL)), behavior: 'smooth' });
        });
      }

      const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
      window.addEventListener('scroll', queue, { passive: true });
      window.addEventListener('resize', queue);
      update();
    }
  }

  /* count-up numbers */
  const countUp = (el) => {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || '0', 10);
    const suffix = el.dataset.suffix || '';
    const show = (v) => { el.textContent = `${v.toFixed(decimals)}${suffix}`; };
    if (reduce) { show(target); return; }
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1400);
      show(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  /* reveal on scroll */
  const revealer = new IntersectionObserver((entries) => {
    let n = 0;
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      el.style.transitionDelay = `${Math.min(n, 4) * 80}ms`;
      n += 1;
      el.classList.add('is-in');
      $$('[data-count]', el).forEach(countUp);
      revealer.unobserve(el);
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
  $$('[data-reveal]').forEach((el) => revealer.observe(el));

  /* local time in Bangalore */
  const clock = $('[data-clock]');
  if (clock) {
    const fmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
    const tickClock = () => {
      const d = new Date();
      clock.textContent = fmt.format(d);
      clock.setAttribute('datetime', d.toISOString());
    };
    tickClock();
    setInterval(tickClock, 15000);
  }

  /* experience line fills as you read down */
  const timeline = $('[data-timeline]');
  const fill = $('[data-timeline-fill]');
  if (timeline && fill) {
    const paint = () => {
      const r = timeline.getBoundingClientRect();
      const k = clamp((window.innerHeight * 0.62 - r.top) / r.height, 0, 1);
      fill.style.height = `${(k * (r.height - 20)).toFixed(1)}px`;
    };
    paint();
    window.addEventListener('scroll', paint, { passive: true });
    window.addEventListener('resize', paint);
  }

  /* copy email */
  $$('[data-copy]').forEach((btn) => {
    const label = btn.textContent;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = 'Copied ✓';
      } catch {
        btn.textContent = btn.dataset.copy;
      }
      setTimeout(() => { btn.textContent = label; }, 1800);
    });
  });

  /* Vulrend ad: word-timed captions, the way Whisper timings drive them */
  const reel = $('[data-reel]');
  if (reel) {
    const cap = $('[data-reel-caption]', reel);
    const bar = $('[data-reel-progress]', reel);
    const PHRASES = ['Cut from 300 GSM cotton,', 'so it still looks like this in a year.', 'New summer collection, out now.'];
    const script = PHRASES.map((p) => p.split(' ').map((w) => ({ w, d: 230 + w.length * 34 })));
    const HOLD = 600;
    const total = script.reduce((sum, ph) => sum + ph.reduce((a, x) => a + x.d, 0) + HOLD, 0);
    let pi = 0, wi = -1, elapsed = 0, timer = 0, running = false;

    const renderPhrase = () => { cap.innerHTML = script[pi].map((x) => `<span>${x.w}</span>`).join(' '); };
    const tick = () => {
      const words = cap.children;
      if (wi >= 0 && words[wi]) { words[wi].classList.remove('now'); words[wi].classList.add('on'); }
      wi += 1;
      if (wi < words.length) {
        words[wi].classList.add('now');
        elapsed += script[pi][wi].d;
        timer = setTimeout(tick, script[pi][wi].d);
      } else {
        elapsed += HOLD;
        timer = setTimeout(() => {
          pi = (pi + 1) % script.length;
          if (pi === 0) elapsed = 0;
          wi = -1;
          renderPhrase();
          tick();
        }, HOLD);
      }
      if (bar) bar.style.width = `${Math.min(100, (elapsed / total) * 100)}%`;
    };

    renderPhrase();
    if (reduce) {
      [...cap.children].forEach((w) => w.classList.add('on'));
    } else {
      new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting && !running) { running = true; tick(); }
        else if (!entry.isIntersecting && running) { running = false; clearTimeout(timer); }
      }, { threshold: 0.3 }).observe(reel);
    }
  }
})();
