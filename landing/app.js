// Playback landing — simulated deck widget, reveals, sticky CTA, notify form.
// The booth is a simulation: no audio is generated. Honest labeling everywhere.
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- reveal on scroll (transform/opacity only) ---------- */
  var revealEls = document.querySelectorAll('.reveal');
  if (REDUCED || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  } else {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); rio.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { rio.observe(el); });
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
      var txt = playbtn.querySelector('.txt');
      if (txt) txt.textContent = on ? 'Pause' : 'Play';
      last = performance.now();
      if (on) kick();
      else { ticking = false; drawWaveIdle(); }
    }

    playbtn.addEventListener('click', function () { setPlaying(!playing); });

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
    var ticking = false;
    function tick(now) {
      if (!playing) { ticking = false; return; }
      var dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      angle = (angle + dt * (BASE_RPM / 60) * 360 * (bpm / 120)) % 360;
      platter.style.transform = 'rotate(' + angle.toFixed(2) + 'deg)';
      drawWave(now);
      requestAnimationFrame(tick);
    }
    function kick() {
      if (ticking || !playing) return;
      ticking = true;
      last = performance.now();
      requestAnimationFrame(tick);
    }

    // Keep the sim cheap: only run while the booth is on screen.
    if ('IntersectionObserver' in window) {
      var vio = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) kick();
          else ticking = false;
        });
      });
      vio.observe(platter);
    }

    /* ---------- waveform: decorative canvas, animated only while playing ---------- */
    var ctx = wave ? wave.getContext('2d') : null;
    var BARS = 48;
    var seed = [];
    for (var i = 0; i < BARS; i++) seed.push(Math.random());

    function barHeights(t, live) {
      var out = [];
      for (var i = 0; i < BARS; i++) {
        var base = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.55 + seed[i] * 6.28));
        var motion = live ? 0.35 * Math.abs(Math.sin(t / 420 + i * 0.35)) : 0;
        out.push(Math.min(1, base * 0.75 + motion));
      }
      return out;
    }

    function drawBars(t, live) {
      if (!ctx) return;
      var w = wave.width, h = wave.height;
      ctx.clearRect(0, 0, w, h);
      var hs = barHeights(t, live);
      var bw = w / BARS;
      ctx.fillStyle = live ? '#f0a33c' : 'rgba(242,237,225,0.28)';
      for (var i = 0; i < BARS; i++) {
        var bh = hs[i] * (h - 8);
        ctx.fillRect(i * bw + bw * 0.25, (h - bh) / 2, bw * 0.5, bh);
      }
    }

    function drawWave(now) { drawBars(now, true); }
    function drawWaveIdle() { drawBars(0, false); }

    if (REDUCED) {
      drawWaveIdle(); // static, never animated
    } else {
      drawWaveIdle();
    }
  }

  /* ---------- sticky mobile CTA ---------- */
  var stick = document.getElementById('stickbar');
  var notify = document.getElementById('notify');
  if (stick && notify && 'IntersectionObserver' in window) {
    stick.hidden = false;
    var sio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        stick.classList.toggle('off', en.isIntersecting);
      });
    }, { threshold: 0.08 });
    sio.observe(notify);
  }

  /* ---------- notify form: front-end only, no backend yet ---------- */
  var form = document.querySelector('form[data-notify]');
  if (!form) return;
  var email = form.querySelector('input[type="email"]');
  var error = form.querySelector('.field-error');
  var button = form.querySelector('button');

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
    button.classList.add('loading');
    setTimeout(function () { window.location.href = './thanks.html'; }, 800);
  });
})();
