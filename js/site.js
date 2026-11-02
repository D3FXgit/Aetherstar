// AetherStar site: karaoke headline, the night walkthrough,
// the score split and the rank ladder. No dependencies.
(() => {
  'use strict';
  document.documentElement.classList.add('js');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Karaoke headline ---------- */
  const k = document.querySelector('[data-karaoke]');
  if (k) {
    const syls = [...k.querySelectorAll('.syl')];
    const bar = k.querySelector('.karaoke__bar');
    syls.forEach((s) => s.setAttribute('data-t', s.textContent));

    const placeBar = (s, animate) => {
      const x = s.offsetLeft;
      const y = s.offsetTop + s.offsetHeight * 1.05;
      bar.style.transition = animate ? 'transform 240ms cubic-bezier(.2,.8,.2,1), width 240ms cubic-bezier(.2,.8,.2,1), opacity 300ms ease' : 'none';
      bar.style.width = `${s.offsetWidth}px`;
      bar.style.transform = `translate(${x}px, ${y}px)`;
    };

    const sing = () => {
      if (reduced) return;
      k.classList.remove('is-done');
      syls.forEach((s) => s.classList.remove('is-sung'));
      k.classList.add('is-playing');
      let t = 0;
      syls.forEach((s, i) => {
        const d = parseFloat(s.dataset.d) || 0.3;
        setTimeout(() => {
          placeBar(s, i > 0);
          s.style.setProperty('--dur', `${d * 1000}ms`);
          s.classList.add('is-sung');
        }, t * 1000);
        t += d + 0.04;
      });
      setTimeout(() => {
        k.classList.remove('is-playing');
        k.classList.add('is-done');
      }, (t + 1.1) * 1000);
    };

    // Wait for the display face so syllable widths are final.
    const start = () => setTimeout(sing, 450);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(start);
    else window.addEventListener('load', start);
    // Sing it again on click, like hitting restart.
    k.addEventListener('click', () => { if (!k.classList.contains('is-playing')) sing(); });
  }

  /* ---------- Bar state and current section ---------- */
  const barEl = document.querySelector('[data-bar]');
  const onScroll = () => barEl && barEl.classList.toggle('is-scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();


  /* ---------- How a night goes ---------- */
  const steps = [...document.querySelectorAll('.step')];
  const frames = [...document.querySelectorAll('.stage__img')];
  if (steps.length && 'IntersectionObserver' in window) {
    const setStep = (n) => {
      steps.forEach((s, i) => s.classList.toggle('is-active', i === n));
      frames.forEach((f, i) => f.classList.toggle('is-active', i === n));
    };
    setStep(0);
    // The pinned screen opens the screenshot of the step being read
    const stage = document.querySelector('.stage');
    if (stage) stage.addEventListener('click', () => {
      const active = steps.findIndex((st) => st.classList.contains('is-active'));
      const btn = steps[Math.max(0, active)].querySelector('.shot');
      if (btn) btn.click();
    });
    const stepIO = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setStep(Number(e.target.dataset.step)); });
    }, { rootMargin: '-42% 0px -42% 0px' });
    steps.forEach((s) => stepIO.observe(s));
  }

  /* ---------- Score split grows in ---------- */
  const split = document.querySelector('[data-split]');
  if (split && 'IntersectionObserver' in window) {
    const sIO = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { split.classList.add('is-in'); sIO.disconnect(); }
    }, { threshold: 0.4 });
    sIO.observe(split);
  } else if (split) split.classList.add('is-in');

  /* ---------- Rank ladder (thresholds from the game) ---------- */
  const RANKS = [
    [9000, 'Superstar', 5], [8000, 'Hit Machine', 4], [7000, 'Lead Singer', 4], [6000, 'Rising Star', 3],
    [5000, 'Hopeful', 3], [4000, 'Wannabe', 2], [2000, 'Amateur', 2], [0, 'Tone Deaf', 1],
  ];
  window.aetherRank = (score) => RANKS.find(([min]) => score >= min);
  const ladder = document.querySelector('[data-ladder]');
  if (ladder) {
    const input = ladder.querySelector('input');
    const out = ladder.querySelector('output');
    const rankEl = ladder.querySelector('[data-rank]');
    const starsEl = ladder.querySelector('[data-stars]');
    const rows = [...ladder.querySelectorAll('tbody tr')];
    const fmt = new Intl.NumberFormat('en-US');
    const update = () => {
      const v = Number(input.value);
      const [min, title, stars] = window.aetherRank(v);
      out.textContent = fmt.format(v);
      rankEl.textContent = title;
      starsEl.innerHTML = `${'★'.repeat(stars)}<span>${'★'.repeat(5 - stars)}</span>`;
      starsEl.setAttribute('aria-label', `${stars} of 5 stars`);
      rows.forEach((r) => r.classList.toggle('is-on', Number(r.dataset.min) === min));
      input.style.setProperty('--fill', `${v / 100}%`);
    };
    input.addEventListener('input', update);
    rows.forEach((r) => {
      r.style.cursor = 'pointer';
      // Tapping a rank lands the slider in the middle of that rank's band.
      // RANKS is sorted high to low, so the band's upper edge is the
      // smallest threshold above this one (or 10,000 for Superstar).
      const pick = () => {
        const min = Number(r.dataset.min);
        const above = RANKS.map(([m]) => m).filter((m) => m > min);
        const max = above.length ? Math.min(...above) : 10000;
        animateTo(Math.round((min + max) / 2 / 50) * 50);
      };
      r.tabIndex = 0;
      r.setAttribute('role', 'button');
      r.addEventListener('click', pick);
      r.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); }
      });
    });
    // Glide the number to a value when a row is tapped
    let raf = 0;
    const animateTo = (target) => {
      cancelAnimationFrame(raf);
      if (reduced) { input.value = target; update(); return; }
      const from = Number(input.value);
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / 520);
        const e = 1 - (1 - p) ** 3;
        input.value = Math.round((from + (target - from) * e) / 10) * 10;
        update();
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    update();
  }
})();
