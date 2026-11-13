import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

const hero = document.querySelector('.hero');
if (hero) {
  gsap.registerPlugin(ScrollTrigger);
  const toggle = document.getElementById('motion-toggle');
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const events = new AbortController();
  const iconBase = new URL('ui/', import.meta.url);
  let canvas = document.getElementById('context-field');
  let field;
  let lenis;
  let intro;
  let visible = true;
  let focused = true;
  let paused = false;
  let disposed = false;
  let generation = 0;
  let lastFrame = 0;
  let resizeObserver;
  let pointerX = 0;
  let pointerY = 0;
  let pointerPending = false;
  const reveals = [];

  function updateMotion() {
    const reduced = preference.matches;
    hero.dataset.motion = reduced || paused ? 'paused' : 'playing';
    hero.dataset.rendering = field && visible && focused && !document.hidden && !paused && !reduced ? 'running' : 'suspended';
    toggle.hidden = !field || reduced;
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? 'Play animation' : 'Pause animation');
    toggle.querySelector('.motion-label').textContent = paused ? 'Play motion' : 'Pause motion';
    toggle.querySelector('img').src = new URL(paused ? 'play-linear.svg' : 'pause-linear.svg', iconBase).href;
    lastFrame = 0;
  }
  function removeField() {
    generation++;
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    field?.dispose();
    field = undefined;
    canvas?.remove();
    canvas = undefined;
    hero.dataset.renderer = 'static';
    updateMotion();
  }
  async function mountField() {
    const currentGeneration = ++generation;
    try {
      const { createContextField } = await import('./hero-scene.js');
      if (disposed || preference.matches || generation !== currentGeneration) return;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'context-field';
        canvas.setAttribute('aria-hidden', 'true');
        hero.querySelector('.hero-poster').after(canvas);
      }
      field = createContextField(canvas, hero);
      field.select(hero.dataset.client);
      resizeObserver = new window.ResizeObserver(() => field?.resize());
      resizeObserver.observe(hero);
      canvas.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        removeField();
      }, { once: true, signal: events.signal });
      hero.dataset.renderer = 'webgl';
      updateMotion();
    } catch {
      if (generation === currentGeneration) removeField();
    }
  }
  function startMotion() {
    ScrollTrigger.enable();
    gsap.ticker.add(tick);
    lenis = new Lenis({ autoRaf: false, smoothWheel: true, syncTouch: false, anchors: true, lerp: 0.12 });
    lenis.on('scroll', ScrollTrigger.update);
    intro = gsap.timeline({ defaults: { ease: 'power2.out' } });
    intro.from('.hero h1 .heading-word', { opacity: 0.72, y: 12, duration: 0.9, stagger: 0.055 }, 0)
      .from('.hero-description, .hero-actions', { opacity: 0.78, y: 8, duration: 0.8, stagger: 0.12 }, 0.25)
      .from('.hero-bottom', { opacity: 0.8, y: 6, duration: 0.7 }, 0.5);
    for (const heading of document.querySelectorAll('.story h2, .download-copy h2')) {
      reveals.push(gsap.from(heading, { y: 8, opacity: 0.85, duration: 0.65, scrollTrigger: { trigger: heading, start: 'top 92%', once: true } }));
    }
    mountField();
  }
  function stopMotion() {
    gsap.ticker.remove(tick);
    lenis?.destroy();
    lenis = undefined;
    intro?.progress(1).kill();
    intro = undefined;
    for (const reveal of reveals.splice(0)) {
      reveal.scrollTrigger?.kill();
      reveal.progress(1).kill();
    }
    ScrollTrigger.disable();
    removeField();
  }
  function tick(time) {
    lenis?.raf(time * 1000);
    if (!field || hero.dataset.rendering !== 'running' || time - lastFrame < 1 / 24) return;
    if (pointerPending) {
      const bounds = hero.getBoundingClientRect();
      field.point((pointerX - bounds.left) / bounds.width - 0.5, 0.5 - (pointerY - bounds.top) / bounds.height);
      pointerPending = false;
    }
    field.render(lastFrame ? time - lastFrame : 0);
    lastFrame = time;
  }
  function refresh() {
    if (!disposed) { lenis?.resize(); ScrollTrigger.refresh(); }
  }
  const title = hero.querySelector('h1');
  title.setAttribute('aria-label', title.innerText.replace(/\s+/g, ' ').trim());
  for (const line of title.querySelectorAll('.heading-line')) {
    line.setAttribute('aria-hidden', 'true');
    line.replaceChildren(...line.textContent.split(' ').flatMap((word, index) => {
      const span = document.createElement('span');
      span.className = 'heading-word';
      span.textContent = word;
      return index ? [document.createTextNode(' '), span] : [span];
    }));
  }
  const observer = new window.IntersectionObserver(entries => { visible = entries[0].isIntersecting; updateMotion(); });
  observer.observe(hero);
  hero.addEventListener('pointermove', event => {
    if (!field || paused || preference.matches || coarsePointer.matches) return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerPending = true;
  }, { passive: true, signal: events.signal });
  hero.addEventListener('pointerleave', () => { pointerPending = false; field?.point(0, 0); }, { signal: events.signal });
  document.addEventListener('sightline:client-change', event => field?.select(event.detail.client), { signal: events.signal });
  document.addEventListener('visibilitychange', updateMotion, { signal: events.signal });
  window.addEventListener('blur', () => { focused = false; updateMotion(); }, { signal: events.signal });
  window.addEventListener('focus', () => { focused = true; updateMotion(); }, { signal: events.signal });
  toggle.addEventListener('click', () => { paused = !paused; if (paused) intro?.progress(1); updateMotion(); }, { signal: events.signal });
  preference.addEventListener('change', () => {
    stopMotion();
    if (!preference.matches) startMotion();
    refresh();
  }, { signal: events.signal });
  for (const image of document.images) image.addEventListener('load', refresh, { once: true, signal: events.signal });
  document.fonts.ready.then(refresh);
  if (preference.matches) stopMotion();
  else startMotion();
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    disposed = true;
    events.abort();
    observer.disconnect();
    gsap.ticker.remove(tick);
    stopMotion();
  }, { signal: events.signal });
}
