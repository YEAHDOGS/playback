// Playback landing — snap panels, parallax drift, clip reveals, simulated deck, honest notify.
// The booth is a simulation: no audio is generated. Honest labeling everywhere.
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- staggered clip reveals (transform/opacity only) ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if (REDUCED || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  } else {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); rio.unobserve(en.target); }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px 0px 0px' });
    revealEls.forEach(function (el) { rio.observe(el); });
  }

  /* ---------- scroll-linked parallax bg drift (transform only, rAF-throttled) ---------- */
  var bgs = Array.prototype.slice.call(document.querySelectorAll('.panel .bg img'));
  var bgPanels = bgs.map(function (img) {
    var panel = img.closest('.panel');
    return { img: img, panel: panel };
  });
  if (REDUCED || !bgPanels.length) {
    bgs.forEach(function (img) { img.style.transform = 'none'; });
  } else {
    var ticking = false;
    function update() {
      ticking = false;
      var vh = window.innerHeight;
      bgPanels.forEach(function (b) {
        var r = b.panel.getBoundingClientRect();
        if (r.bottom < -vh || r.top > 2 * vh) return; // offscreen-ish: skip
        var progress = (r.top + r.height / 2 - vh / 2) / vh; // -0.5..0.5 at rest
        var shift = Math.max(-1, Math.min(1, progress)) * vh * 0.08;
        b.img.style.transform = 'translate3d(0,' + shift.toFixed(1) + 'px,0)';
      });
    }
    function requestTick() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    window.addEventListener('scroll', requestTick, { passive: true });
    window.addEventListener('resize', requestTick);
    update();
  }

  /* ---------- simulated deck ---------- */
  var platter = document.getElementById('platter');
  var playbtn = document.getElementById('playbtn');
  var wave = document.getElementById('wave');

  if (platter && playbtn) {
    var playing = false;
    var bpm = 120;
    var angle = 0;
    var last = 0;
    var BASE_RPM = 33.333;

    function renderBpm() {
      var read = document.getElementById('bpm-read');
      if (read) read.innerHTML = bpm.toFixed(1) + ' <small>BPM</small>';
    }

    function setPlaying(on) {
      playing = on;
      playbtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      playbtn.setAttribute('aria-label', on ? 'Pause simulated deck' : 'Play simulated deck');
      var txt = playbtn.querySelector('.ptx');
      if (txt) txt.textContent = on ? 'Pause' : 'Play';
      last = performance.now();
      if (on) kick();
      else { spinOn = false; drawWaveIdle(); }
    }

    playbtn.addEventListener('click', function () { setPlaying(!playing); });

    // Keyboard shortcuts — the honest version of the KEYS panel.
    document.addEventListener('keydown', function (e) {
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!playing); }
      else if (e.key === 'ArrowLeft') { bpm = Math.max(60, bpm - 1); renderBpm(); }
      else if (e.key === 'ArrowRight') { bpm = Math.min(180, bpm + 1); renderBpm(); }
      else if (e.key === 'm' || e.key === 'M') {
        var booth = playbtn.closest('.booth');
        if (booth) booth.classList.toggle('muted');
      }
    });

    var down = document.getElementById('bpm-down');
    var up = document.getElementById('bpm-up');
    if (down) down.addEventListener('click', function () { bpm = Math.max(60, bpm - 1); renderBpm(); });
    if (up) up.addEventListener('click', function () { bpm = Math.min(180, bpm + 1); renderBpm(); });
    renderBpm();

    var xf = document.getElementById('xfader');
    var xa = document.getElementById('xa');
    var xb = document.getElementById('xb');
    function renderXf() {
      var v = parseInt(xf.value, 10) || 0; // -100..100
      var a = Math.round(50 - v / 2);
      var b = 100 - a;
      if (xa) xa.textContent = 'A ' + a;
      if (xb) xb.textContent = b + ' B';
    }
    if (xf) { xf.addEventListener('input', renderXf); renderXf(); }

    // Spin: transform-only, paused when hidden or reduced-motion.
    var spinOn = false;
    function tick(now) {
      if (!playing) { spinOn = false; return; }
      var dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      angle = (angle + dt * (BASE_RPM / 60) * 360 * (bpm / 120)) % 360;
      platter.style.transform = 'rotate(' + angle.toFixed(2) + 'deg)';
      drawWave(now);
      requestAnimationFrame(tick);
    }
    function kick() {
      if (spinOn || !playing) return;
      spinOn = true;
      last = performance.now();
      requestAnimationFrame(tick);
    }

    // Keep the sim cheap: only run while the booth is on screen.
    if ('IntersectionObserver' in window) {
      var vio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) kick();
          else spinOn = false;
        });
      });
      vio.observe(platter);
    }

    /* ---------- waveform: decorative canvas, animated only while playing ---------- */
    var ctx = wave ? wave.getContext('2d') : null;
    var BARS = 48;
    var seed = [];
    for (var i = 0; i < BARS; i++) seed.push(Math.random());

    function drawBars(t, live) {
      if (!ctx) return;
      var w = wave.width, h = wave.height;
      ctx.clearRect(0, 0, w, h);
      var bw = w / BARS;
      ctx.fillStyle = live ? '#f0a33c' : 'rgba(242,237,225,0.28)';
      for (var j = 0; j < BARS; j++) {
        var base = 0.25 + 0.75 * Math.abs(Math.sin(j * 0.55 + seed[j] * 6.28));
        var motion = live ? 0.35 * Math.abs(Math.sin(t / 420 + j * 0.35)) : 0;
        var bh = Math.min(1, base * 0.75 + motion) * (h - 8);
        ctx.fillRect(j * bw + bw * 0.25, (h - bh) / 2, bw * 0.5, bh);
      }
    }

    function drawWave(now) { drawBars(now, true); }
    function drawWaveIdle() { drawBars(0, false); }
    drawWaveIdle();
  }

  /* ---------- notify form: honest localStorage capture, no backend yet ---------- */
  var form = document.querySelector('form[data-notify]');
  if (!form) return;
  var email = form.querySelector('input[type="email"]');
  var error = form.querySelector('.field-error');
  var button = form.querySelector('button');

  // If already saved on this device, say so instead of the form.
  try {
    var saved = window.localStorage.getItem('playback-notify');
    if (saved) {
      form.innerHTML = '<p class="done-msg">You are on the list (' + saved.replace(/</g, '&lt;') +
        '). We will ping you here when Playback wakes up.</p>';
      return;
    }
  } catch (e) { /* storage unavailable — form still works for the session */ }

  function setError(msg) {
    error.textContent = msg;
    email.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) email.focus();
  }

  email.addEventListener('input', function () { setError(''); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var value = email.value.trim();
    if (!value) { setError('Please enter your email address.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('That does not look like an email address. Try again?');
      return;
    }
    setError('');
    button.disabled = true;
    try { window.localStorage.setItem('playback-notify', value); } catch (err) { /* session-only */ }
    form.innerHTML = '<p class="done-msg">Saved on this device. First ping when Playback wakes up.</p>';
  });
})();
