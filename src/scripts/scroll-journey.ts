// Move on only after a real downward gesture, never on load, restoration, or Back.
let navigating = false;
addEventListener('pageshow', () => { navigating = false; });

export function scrollJourney(gate: HTMLElement, link: HTMLAnchorElement, enabled: () => boolean, options: { atEnd?: boolean } = {}) {
  let previous = gate.getBoundingClientRect().top;
  let lastY = scrollY;
  let gestureAt = 0;
  let entering = false;
  let frame = 0;
  const gesture = () => {
    gestureAt = performance.now();
    // At the page bottom, a wheel or swipe no longer produces a scroll event.
    if (options.atEnd) requestAnimationFrame(() => check(true));
  };
  addEventListener('wheel', (e) => { if (e.deltaY > 0) gesture(); }, { passive: true });
  let touchY = 0;
  addEventListener('touchstart', (e) => { touchY = e.touches[0]?.clientY ?? 0; }, { passive: true });
  addEventListener('touchmove', (e) => { if ((e.touches[0]?.clientY ?? touchY) < touchY) gesture(); }, { passive: true });
  addEventListener('keydown', (e) => {
    if (e.target instanceof Element && e.target.closest('input, textarea, select, button, [contenteditable]')) return;
    if (['ArrowDown', 'PageDown', ' '].includes(e.key)) gesture();
  });
  addEventListener('pageshow', () => { entering = false; gestureAt = 0; previous = gate.getBoundingClientRect().top; lastY = scrollY; });
  function check(fromGesture = false) {
      const top = gate.getBoundingClientRect().top;
      const line = innerHeight * 0.8;
      // A fast swipe can move the entire gate above the viewport in one frame.
      const crossed = previous > line && top <= line;
      const down = scrollY > lastY;
      const atEnd = options.atEnd && fromGesture && top <= line && scrollY + innerHeight >= document.documentElement.scrollHeight - 4;
      previous = top;
      lastY = scrollY;
      if ((!crossed || !down) && !atEnd) return;
      if (entering || navigating || !gestureAt || !enabled() || gate.closest('.is-hidden') || performance.now() - gestureAt > 1800) return;
      if (link.origin !== location.origin || link.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '')) return;
      entering = true;
      navigating = true;
      sessionStorage.setItem('journey-auto-entry', link.pathname);
      link.click();
  }
  addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      check();
    });
  }, { passive: true });
}

export function autoJourneyEnabled() {
  return localStorage.getItem('journey-auto') !== 'off';
}
