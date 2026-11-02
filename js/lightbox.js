// Screenshot viewer. Any <button class="shot" data-full="..."> opens it.
// Zooms out of the thumbnail and back into it, arrows and swipe move through
// the screenshots on the page, F or the button goes fullscreen, Esc closes.
(() => {
  'use strict';
  const shots = [...document.querySelectorAll('.shot[data-full]')];
  if (!shots.length) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const icon = {
    close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>',
    full: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5"/></svg>',
    exit: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v5H3M12 3v5h5M8 17v-5H3M12 17v-5h5"/></svg>',
    prev: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 4l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4l6 6-6 6"/></svg>',
  };

  const lb = document.createElement('div');
  lb.className = 'lb';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Screenshot');
  lb.innerHTML = `
    <div class="lb__top">
      <span class="lb__count" aria-live="polite"></span>
      <div class="lb__tools">
        <button class="lb__btn" type="button" data-full aria-label="Fullscreen">${icon.full}</button>
        <button class="lb__btn" type="button" data-close aria-label="Close">${icon.close}</button>
      </div>
    </div>
    <div class="lb__stage">
      <img class="lb__img" alt="">
      <button class="lb__btn lb__nav lb__nav--prev" type="button" data-prev aria-label="Previous screenshot">${icon.prev}</button>
      <button class="lb__btn lb__nav lb__nav--next" type="button" data-next aria-label="Next screenshot">${icon.next}</button>
    </div>
    <p class="lb__cap"></p>`;
  document.body.append(lb);

  const img = lb.querySelector('.lb__img');
  const cap = lb.querySelector('.lb__cap');
  const count = lb.querySelector('.lb__count');
  const fullBtn = lb.querySelector('[data-full]');
  const closeBtn = lb.querySelector('[data-close]');
  const prevBtn = lb.querySelector('[data-prev]');
  const nextBtn = lb.querySelector('[data-next]');
  const canFull = !!(lb.requestFullscreen || lb.webkitRequestFullscreen);
  if (!canFull) fullBtn.hidden = true;
  if (shots.length < 2) { prevBtn.hidden = true; nextBtn.hidden = true; }

  let index = 0;
  let opener = null;

  const thumbOf = (i) => shots[i].querySelector('img');
  const show = (i) => {
    index = (i + shots.length) % shots.length;
    const s = shots[index];
    const t = thumbOf(index);
    img.src = t.currentSrc || t.src; // instant, then the sharp one
    const hi = new Image();
    hi.src = s.dataset.full;
    hi.onload = () => { if (shots[index] === s) img.src = hi.src; };
    img.alt = t.alt;
    cap.textContent = s.dataset.caption || t.alt;
    count.textContent = `${index + 1} of ${shots.length}`;
  };

  // FLIP: animate from the thumbnail's box to the image's resting box
  const flip = (fromEl, reverse) => new Promise((done) => {
    if (reduced || !fromEl) { done(); return; }
    const a = fromEl.getBoundingClientRect();
    const b = img.getBoundingClientRect();
    if (!b.width || !a.width) { done(); return; }
    const tf = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height})`;
    const frames = reverse ? [{ transform: 'none' }, { transform: tf }] : [{ transform: tf }, { transform: 'none' }];
    const anim = img.animate(frames, { duration: reverse ? 320 : 460, easing: reverse ? 'cubic-bezier(.4,0,.2,1)' : 'cubic-bezier(.2,.9,.25,1)' });
    anim.onfinish = done;
    anim.oncancel = done;
  });

  const open = async (i) => {
    opener = shots[i];
    show(i);
    lb.classList.add('is-open');
    document.documentElement.style.overflow = 'hidden';
    await new Promise((r) => (img.complete ? r() : img.addEventListener('load', r, { once: true })));
    flip(thumbOf(i), false);
    closeBtn.focus({ preventScroll: true });
  };

  const close = async () => {
    if (!lb.classList.contains('is-open')) return;
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    const target = thumbOf(index);
    const inView = target.getBoundingClientRect();
    if (inView.bottom > 0 && inView.top < innerHeight) await flip(target, true);
    lb.classList.remove('is-open');
    document.documentElement.style.overflow = '';
    (shots[index] || opener).focus({ preventScroll: true });
  };

  const toggleFull = () => {
    if (!canFull) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      (lb.requestFullscreen || lb.webkitRequestFullscreen).call(lb);
    }
  };
  const syncFull = () => {
    const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fullBtn.innerHTML = on ? icon.exit : icon.full;
    fullBtn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
  };
  document.addEventListener('fullscreenchange', syncFull);
  document.addEventListener('webkitfullscreenchange', syncFull);

  shots.forEach((s, i) => s.addEventListener('click', () => open(i)));
  closeBtn.addEventListener('click', close);
  fullBtn.addEventListener('click', toggleFull);
  prevBtn.addEventListener('click', () => show(index - 1));
  nextBtn.addEventListener('click', () => show(index + 1));
  // Clicking the dark area around the picture closes it
  lb.querySelector('.lb__stage').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
  img.addEventListener('dblclick', toggleFull);

  lb.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.fullscreenElement) { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
    else if (e.key === 'f' || e.key === 'F') toggleFull();
    else if (e.key === 'Tab') {
      // Keep focus inside the viewer
      const f = [...lb.querySelectorAll('button:not([hidden])')];
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Swipe: sideways moves through the screenshots, down closes
  let sx = 0, sy = 0, dx = 0, dy = 0, tracking = false;
  lb.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || e.target.closest('button')) return;
    tracking = true; sx = e.clientX; sy = e.clientY; dx = dy = 0;
    img.style.transition = 'none';
  });
  lb.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    dx = e.clientX - sx; dy = e.clientY - sy;
    const down = Math.max(0, dy);
    // Follows the finger, with resistance on the off axis
    img.style.transform = Math.abs(dx) > Math.abs(dy)
      ? `translateX(${dx}px)`
      : `translateY(${down}px) scale(${1 - Math.min(down / 1600, 0.12)})`;
  });
  const endSwipe = () => {
    if (!tracking) return;
    tracking = false;
    img.style.transition = 'transform 380ms cubic-bezier(.2,.9,.25,1)';
    img.style.transform = '';
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
    else if (dy > 110) close();
  };
  lb.addEventListener('pointerup', endSwipe);
  lb.addEventListener('pointercancel', endSwipe);
})();
