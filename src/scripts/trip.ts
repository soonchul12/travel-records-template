import maplibregl from './maplibre';
import type { GeoJSONSource } from 'maplibre-gl';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';
import { scrollJourney, autoJourneyEnabled } from './scroll-journey';

type LngLat = [number, number];
type Photo = { id: string; coords: LngLat; md: string };
type Stop = {
  id: string;
  name: string;
  kind: string;
  coords: LngLat;
  hour: number;
  time: string;
  camera: { zoom: number; pitch: number; bearing: number };
  photos: Photo[];
};
type Day = { day: number; accent: string; route: LngLat[]; stops: Stop[] };
type TripData = { bbox: [LngLat, LngLat]; days: Day[] };

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileQuery = matchMedia('(max-width: 860px)');
const mobile = () => mobileQuery.matches;
const data: TripData = JSON.parse(document.getElementById('trip-data')!.textContent!);
const stopById = new Map(data.days.flatMap((d) => d.stops.map((s) => [s.id, { ...s, day: d.day, accent: d.accent }])));
const dayByNo = new Map(data.days.map((d) => [d.day, d]));
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
const routePanel = document.querySelector('.route-panel')!;
const routeField = (name: string, value: string) => { document.querySelector(`[data-route="${name}"]`)!.textContent = value; };
let currentLeg: LngLat[] = [];
let currentStop: (Stop & { day: number; accent: string }) | null = null;
let mapView: 'route' | 'place' = 'route';
function setMapView(view: 'route' | 'place') {
  mapView = view;
  document.querySelectorAll('[data-map-view]').forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.mapView === view)));
}

// ── 화면에 들어오면 드러나기 · 숫자 올라가기 ──
const revealer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('is-in');
      e.target.querySelectorAll<HTMLElement>('[data-count]').forEach(countUp);
      revealer.unobserve(e.target);
    }
  },
  { threshold: 0.2 },
);
document.querySelectorAll('.reveal').forEach((el) => revealer.observe(el));

function countUp(el: HTMLElement) {
  const target = Number(el.dataset.count);
  if (reduced) return;
  const t0 = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / 1800);
    el.textContent = Math.round(target * (1 - (1 - p) ** 4)).toLocaleString('en-US');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── 진행 막대 ──
const bar = $('.progress span');
addEventListener(
  'scroll',
  () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar?.style.setProperty('--p', String(max > 0 ? scrollY / max : 0));
    document.body.classList.toggle('past-hero', scrollY > innerHeight * 0.8);
  },
  { passive: true },
);

// 이야기 구간에 들어오면 지도와 날짜 레일을 켠다
new IntersectionObserver(([e]) => document.body.classList.toggle('in-story', e.isIntersecting), {
  rootMargin: '-50% 0px -50% 0px',
}).observe($('#story')!);

const railLinks = [...document.querySelectorAll<HTMLElement>('[data-rail-day]')];
function setDay(day: number) {
  railLinks.forEach((a) => a.classList.toggle('is-active', Number(a.dataset.railDay) === day));
  const accent = dayByNo.get(day)?.accent;
  if (accent) document.documentElement.style.setProperty('--accent', accent);
}

// ── 시간대별 빛: 사진 찍은 시각으로 지도 하늘·안개·색조를 바꾼다 ──
const PHASES = [
  { until: 5, name: 'Night', tint: '#1b2a6b', sky: '#05060d', horizon: '#141a33' },
  { until: 8, name: 'Dawn', tint: '#f3a6a0', sky: '#1a1420', horizon: '#6b4a4a' },
  { until: 16, name: 'Daylight', tint: '#a9c7ff', sky: '#0e1420', horizon: '#3a4658' },
  { until: 19, name: 'Golden Hour', tint: '#ff9a4a', sky: '#1a1210', horizon: '#7a4524' },
  { until: 24, name: 'Night', tint: '#1b2a6b', sky: '#05060d', horizon: '#141a33' },
];
const phaseOf = (h: number) => PHASES.find((p) => h < p.until)!;
const tintEl = $('.map-tint')!;
function setLight(hour: number | null) {
  const p = hour == null ? null : phaseOf(hour);
  tintEl.style.setProperty('--tint', p ? p.tint : 'transparent');
  if (!ready) return;
  map.setSky({
    'sky-color': p?.sky ?? '#0b0b0d',
    'horizon-color': p?.horizon ?? '#2a2522',
    'fog-color': '#0b0b0d',
    'sky-horizon-blend': 0.6,
    'horizon-fog-blend': 0.7,
    'fog-ground-blend': 0.4,
  });
}

// ── 화면 아래 위치 표시: 글자가 잠깐 뒤섞였다가 맞춰진다 ──
const hud = {
  phase: $('[data-hud="phase"]')!,
  place: $('[data-hud="place"]')!,
  coords: $('[data-hud="coords"]')!,
};
const GLYPHS = '0123456789ABCDEF°·.';
function scramble(el: HTMLElement, text: string) {
  if (reduced) return void (el.textContent = text);
  const t0 = performance.now();
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / 700);
    const fixed = Math.floor(text.length * p);
    el.textContent = text
      .split('')
      .map((c, i) => (i < fixed || c === ' ' ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0]))
      .join('');
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
const fmtCoords = ([lng, lat]: LngLat) => `${lat.toFixed(4)}° N · ${lng.toFixed(4)}° E`;
function setHud(phase: string, place: string, coords: LngLat) {
  hud.phase.textContent = phase;
  hud.place.textContent = place;
  scramble(hud.coords, fmtCoords(coords));
}

// ── 지도 ──
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark',
  bounds: data.bbox,
  fitBoundsOptions: { padding: mobile() ? 30 : 80 },
  interactive: false,
  attributionControl: { compact: true },
  maxPitch: 78,
});
map.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left');
map.on('move', () => {
  map.getContainer().dataset.zoom = map.getZoom().toFixed(2);
  map.getContainer().dataset.center = map.getCenter().toArray().join(',');
});
const endpoint = (label: string, className: string) => {
  const el = document.createElement('div');
  el.className = `route-endpoint ${className}`;
  el.innerHTML = `<span>${label}</span><b></b>`;
  return new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -6] });
};
const departure = endpoint('출발', 'departure');
const arrival = endpoint('도착', 'arrival');
function showLeg(route: LngLat[], from: string, to: string) {
  currentLeg = route;
  (map.getSource('leg') as GeoJSONSource).setData(route.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } } : EMPTY);
  departure.remove(); arrival.remove();
  if (route.length > 1) departure.setLngLat(route[0]).addTo(map);
  if (route.length) arrival.setLngLat(route[route.length - 1]).addTo(map);
  routeField('from', from); routeField('to', to);
  routePanel.classList.add('has-route');
}
function fitLeg() {
  if (!currentLeg.length) return;
  const bounds = currentLeg.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(currentLeg[0], currentLeg[0]));
  const { w, h, wide } = viewport();
  map.fitBounds(bounds, { padding: wide ? { top: 200, bottom: 120, left: 140, right: w * .42 } : { top: Math.min(260, h * .32), bottom: Math.min(170, h * .22), left: 60, right: 60 }, maxZoom: 15, pitch: mobile() ? 18 : 38, bearing: 0, duration: reduced ? 0 : 1500 });
}
function zoomPlace() {
  if (!currentStop) return;
  const { w, wide } = viewport();
  map.flyTo({ center: currentStop.coords, zoom: Math.min(Math.max(currentStop.camera.zoom + 1, 16), 18), pitch: mobile() ? 35 : currentStop.camera.pitch, bearing: 0, offset: wide ? [-w * .2, 0] : [0, 30], duration: reduced ? 0 : 2800 });
}
document.querySelectorAll<HTMLButtonElement>('[data-map-view]').forEach(button => button.addEventListener('click', () => {
  whenReady(() => {
    orbitFor = ''; map.stop();
    setMapView(button.dataset.mapView as 'route' | 'place');
    mapView === 'route' ? fitLeg() : zoomPlace();
  });
}));

let ready = false;
let pending: (() => void) | null = null;
const whenReady = (fn: () => void) => (ready ? fn() : (pending = fn));
const EMPTY = { type: 'FeatureCollection' as const, features: [] };

map.on('load', () => {
  for (const id of ['dem', 'dem-hs']) {
    map.addSource(id, {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 13,
    });
  }
  const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  map.addLayer(
    {
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem-hs',
      paint: {
        'hillshade-exaggeration': 0.6,
        'hillshade-shadow-color': '#000000',
        'hillshade-highlight-color': '#5a5550',
        'hillshade-accent-color': '#1a1a1a',
      },
    },
    firstSymbol,
  );
  map.addSource('routes', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.days.map((d) => ({
        type: 'Feature',
        properties: { day: d.day, accent: d.accent },
        geometry: { type: 'LineString', coordinates: d.route },
      })),
    },
  });
  map.addSource('active-route', { type: 'geojson', data: EMPTY, lineMetrics: true });
  map.addSource('head', { type: 'geojson', data: EMPTY });
  map.addSource('shots', { type: 'geojson', data: EMPTY });
  map.addSource('leg', { type: 'geojson', data: EMPTY, lineMetrics: true });

  map.addLayer({
    id: 'routes-all',
    type: 'line',
    source: 'routes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'accent'], 'line-opacity': 0.28, 'line-width': 1.4, 'line-dasharray': [2, 3] },
  });
  map.addLayer({
    id: 'route-glow',
    type: 'line',
    source: 'active-route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 12, 'line-blur': 10, 'line-opacity': 0.35 },
  });
  map.addLayer({
    id: 'route-active',
    type: 'line',
    source: 'active-route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffffff', 'line-width': 3.5 },
  });
  map.addLayer({
    id: 'shots',
    type: 'circle',
    source: 'shots',
    paint: {
      'circle-radius': ['case', ['boolean', ['feature-state', 'hover'], false], 8, 3.5],
      'circle-color': ['get', 'accent'],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0.8],
      'circle-opacity': 0.9,
    },
  });
  map.addLayer({ id: 'leg-glow', type: 'line', source: 'leg', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffd982', 'line-width': 14, 'line-blur': 8, 'line-opacity': .65 } });
  map.addLayer({ id: 'leg-line', type: 'line', source: 'leg', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffd982', 'line-width': 4.5 } });
  map.addLayer({ id: 'leg-arrows', type: 'symbol', source: 'leg', layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'text-field': '›', 'text-size': 30, 'text-keep-upright': false, 'text-allow-overlap': false }, paint: { 'text-color': '#fff5dc', 'text-halo-color': '#342511', 'text-halo-width': 2 } });
  map.addLayer({
    id: 'head-glow',
    type: 'circle',
    source: 'head',
    paint: { 'circle-radius': 18, 'circle-color': ['get', 'accent'], 'circle-blur': 1, 'circle-opacity': 0.8 },
  });
  map.addLayer({
    id: 'head',
    type: 'circle',
    source: 'head',
    paint: { 'circle-radius': 5, 'circle-color': '#ffffff' },
  });
  ready = true;
  setLight(null);
  pending?.();
  pending = null;
});

// 장소 표시: 같은 좌표(거의 같은 곳)는 하나만
const markers = new Map<string, HTMLElement>();
const seen = new Map<string, HTMLElement>();
for (const d of data.days) {
  for (const s of d.stops) {
    const key = s.coords.map((v) => v.toFixed(3)).join(',');
    let el = seen.get(key);
    if (!el) {
      el = document.createElement('div');
      el.className = 'mk';
      el.style.setProperty('--c', d.accent);
      el.innerHTML = '<span class="mk-dot"></span><span class="mk-label"></span>';
      el.querySelector('.mk-label')!.textContent = s.name;
      new maplibregl.Marker({ element: el, anchor: 'left', offset: [-5, 0], opacityWhenCovered: '0.8' })
        .setLngLat(s.coords)
        .addTo(map);
      seen.set(key, el);
    }
    markers.set(s.id, el);
  }
}

// 경로 그리기: 선이 자라면서 앞머리에 빛나는 점이 따라간다
let raf = 0;
function along(route: LngLat[], t: number): LngLat {
  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const d = Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
    seg.push(d);
    total += d;
  }
  let want = total * t;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const k = seg[i] ? Math.min(1, want / seg[i]) : 1;
      return [route[i][0] + (route[i + 1][0] - route[i][0]) * k, route[i][1] + (route[i + 1][1] - route[i][1]) * k];
    }
    want -= seg[i];
  }
  return route[route.length - 1];
}
function drawRoute(day: number, route = dayByNo.get(day)!.route) {
  const d = dayByNo.get(day)!;
  (map.getSource('active-route') as GeoJSONSource).setData({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: route },
  });
  cancelAnimationFrame(raf);
  const t0 = performance.now();
  const dur = reduced ? 1 : 2600;
  const head = map.getSource('head') as GeoJSONSource;
  const tick = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    const e = Math.max(1e-4, 1 - (1 - p) ** 3);
    const grad = ['step', ['line-progress'], d.accent, e, 'rgba(0,0,0,0)'];
    map.setPaintProperty('leg-line', 'line-gradient', ['step', ['line-progress'], '#ffd982', e, 'rgba(0,0,0,0)']);
    map.getContainer().dataset.routeProgress = p.toFixed(3);
    map.setPaintProperty('route-active', 'line-gradient', grad);
    map.setPaintProperty('route-glow', 'line-gradient', grad);
    head.setData(
      p < 1
        ? { type: 'Feature', properties: { accent: d.accent }, geometry: { type: 'Point', coordinates: along(route, e) } }
        : EMPTY,
    );
    if (p < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

function markActive(stopId: string | null, day: number) {
  const today = new Set(dayByNo.get(day)!.stops.map((s) => markers.get(s.id)));
  const active = stopId ? markers.get(stopId) : null;
  for (const el of new Set(markers.values())) {
    el.classList.toggle('is-active', el === active);
    el.classList.toggle('is-today', today.has(el));
  }
}

// 사진마다 찍은 지점
function showShots(stop: Stop | null, accent = '#fff') {
  (map.getSource('shots') as GeoJSONSource).setData(
    stop
      ? {
          type: 'FeatureCollection',
          features: stop.photos.map((p, i) => ({
            type: 'Feature',
            id: i,
            properties: { id: p.id, accent },
            geometry: { type: 'Point', coordinates: p.coords },
          })),
        }
      : EMPTY,
  );
}

function viewport() {
  const { width: w, height: h } = map.getContainer().getBoundingClientRect();
  return { w, h, wide: w > 860 };
}

let terrainOn = false;
function terrain(on: boolean) {
  if (on === terrainOn) return;
  terrainOn = on;
  map.setTerrain(on ? { source: 'dem', exaggeration: 1.5 } : null);
}

// 도착한 뒤엔 카메라가 천천히 돈다
let orbitFor = '';
function orbit(id: string) {
  if (reduced || mobile() || orbitFor !== id) return;
  map.easeTo({ bearing: map.getBearing() + 28, duration: 26000, easing: (t) => t, essential: true });
}
map.on('moveend', (e: any) => {
  if (e.orbit || !orbitFor) return;
  const id = orbitFor;
  map.once('idle', () => orbit(id));
});

function showDay(day: number) {
  whenReady(() => {
    orbitFor = '';
    const d = dayByNo.get(day)!;
    currentStop = stopById.get(d.stops.at(-1)?.id ?? '') ?? null;
    setMapView('route');
    terrain(!mobile());
    const b = d.route.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(d.route[0], d.route[0]));
    const { w, h, wide } = viewport();
    map.fitBounds(b, {
      padding: wide
        ? { top: h * 0.16, bottom: h * 0.16, left: w * 0.38, right: w * 0.1 }
        : { top: Math.min(260, h * .32), bottom: Math.min(170, h * .22), left: 60, right: 60 },
      maxZoom: 13.5,
      pitch: mobile() ? 18 : 48,
      bearing: mobile() ? 0 : -12,
      duration: reduced ? 0 : mobile() ? 900 : 2600,
      essential: true,
    });
    drawRoute(day);
    showLeg(d.route, d.stops[0]?.name ?? '출발 지점', d.stops.at(-1)?.name ?? '도착 지점');
    routeField('day', `DAY ${String(day).padStart(2, '0')} · 오늘의 이동 경로`);
    routeField('detail', `${d.stops.length}곳의 방문 장소 · 사진 위치로 이은 경로`);
    markActive(null, day);
    showShots(null);
    stopCycle();
    setLight(null);
    map.getContainer().classList.add('is-overview');
    setHud(`DAY ${String(day).padStart(2, '0')} · THE ROUTE`, d.stops.map((s) => s.name).join(' → '), b.getCenter().toArray() as LngLat);
  });
}

function showStop(id: string) {
  whenReady(() => {
    const s = stopById.get(id)!;
    currentStop = s;
    orbitFor = '';
    terrain(!mobile() && (s.kind === 'nature' || s.kind === 'stay'));
    const d = dayByNo.get(s.day)!;
    const index = d.stops.findIndex(stop => stop.id === id);
    const previous = d.stops[index - 1];
    const nearest = (point: LngLat) => d.route.reduce((best, c, i) => Math.hypot(c[0] - point[0], c[1] - point[1]) < Math.hypot(d.route[best][0] - point[0], d.route[best][1] - point[1]) ? i : best, 0);
    const start = previous ? nearest(previous.coords) : 0;
    const end = nearest(s.coords);
    let leg = d.route.slice(Math.min(start, end), Math.max(start, end) + 1);
    if (start > end) leg.reverse();
    if (leg.length < 2) leg = previous ? [previous.coords, s.coords] : [d.route[0], s.coords];
    showLeg(leg, previous?.name ?? '출발 지점', s.name);
    routeField('day', `DAY ${String(s.day).padStart(2, '0')} · 현재 ${s.name}`);
    routeField('detail', `${s.time} 도착 · 사진 위치 기준 · ${s.coords[1].toFixed(3)}° N, ${s.coords[0].toFixed(3)}° E`);
    setMapView('place');
    zoomPlace();
    drawRoute(s.day, leg);
    markActive(id, s.day);
    showShots(s, s.accent);
    startCycle(id);
    setLight(s.hour);
    map.getContainer().classList.remove('is-overview');
    setHud(`DAY ${String(s.day).padStart(2, '0')} · ${s.time} · ${phaseOf(s.hour).name.toUpperCase()}`, s.name, s.coords);
  });
}

// ── 화면 한가운데를 지나는 제목·장소 카드가 지도를 움직인다 ──
const targets = [...document.querySelectorAll<HTMLElement>('[data-map-target]')];
const mapStage = document.getElementById('map-stage')!;
let activeTarget: HTMLElement | null = null;
function mountMap(el: HTMLElement) {
  activeTarget = el;
  routePanel.classList.toggle('is-visible', el.classList.contains('step'));
  updatePhotoReading();
}
function updatePhotoReading() {
  const card = activeTarget?.querySelector('.card');
  document.body.classList.toggle('reading-photos', !!card && card.getBoundingClientRect().top < innerHeight * .65);
}
mobileQuery.addEventListener('change', () => {
  map.resize();
  if (activeTarget?.dataset.mapTarget === 'stop') showStop(activeTarget.dataset.stopId!);
  else if (activeTarget?.dataset.mapTarget === 'day') showDay(Number(activeTarget.dataset.day));
});
// Choose from the current document position, including after fast swipes and resize.
// IntersectionObserver can miss narrow activation strips when a swipe skips them.
function syncTarget() {
  const line = innerHeight * (mobile() ? .2 : .5);
  let current: HTMLElement | null = null;
  for (const target of targets) {
    if (target.getBoundingClientRect().top <= line) current = target;
    else break;
  }
  if (!current || current === activeTarget) { updatePhotoReading(); return; }
  activeTarget?.classList.remove('is-active');
  mountMap(current);
  current.classList.add('is-active');
  const day = Number(current.dataset.day);
  setDay(day);
  if (document.body.classList.contains('exploring')) return;
  if (current.dataset.mapTarget === 'day') showDay(day);
  else if (current.dataset.mapTarget === 'stop') showStop(current.dataset.stopId!);
  else { orbitFor = ''; stopCycle(); map.stop(); }
}
let targetFrame = 0;
function queueTarget() {
  if (targetFrame) return;
  targetFrame = requestAnimationFrame(() => { targetFrame = 0; syncTarget(); });
}
addEventListener('scroll', queueTarget, { passive: true });
addEventListener('resize', queueTarget, { passive: true });
addEventListener('pageshow', queueTarget);
queueTarget();

// ── 사진을 찍은 곳이 지도에서 빛난다 ──
// 마우스: 사진에 올리면 표시.  터치 화면: 장소에 도착하면 사진을 하나씩 돌아가며 자동으로 표시.
const pinEl = document.createElement('div');
pinEl.className = 'photo-pin';
pinEl.innerHTML = '<img alt="" />';
const pin = new maplibregl.Marker({ element: pinEl, anchor: 'bottom', offset: [0, -12] }).setLngLat([0, 0]).addTo(map);
let hovered: number | null = null;
let pinnedThumb: HTMLElement | null = null;

function showPin(stopId: string, i: number, thumb?: HTMLElement) {
  const s = stopById.get(stopId);
  if (!s || !s.photos[i] || !ready) return;
  if (hovered != null) map.setFeatureState({ source: 'shots', id: hovered }, { hover: false });
  hovered = i;
  map.setFeatureState({ source: 'shots', id: i }, { hover: true });
  pinEl.style.setProperty('--c', s.accent);
  pinEl.querySelector('img')!.src = s.photos[i].md;
  pin.setLngLat(s.photos[i].coords);
  pinEl.classList.add('is-on');
  pinnedThumb?.classList.remove('is-pinned');
  pinnedThumb = thumb ?? null;
  pinnedThumb?.classList.add('is-pinned');
}
function hidePin() {
  pinEl.classList.remove('is-on');
  pinnedThumb?.classList.remove('is-pinned');
  pinnedThumb = null;
  if (hovered != null && ready) map.setFeatureState({ source: 'shots', id: hovered }, { hover: false });
  hovered = null;
}

document.querySelectorAll<HTMLElement>('.thumb[data-photo]').forEach((a) => {
  a.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    const s = stopById.get(a.dataset.stop!);
    showPin(a.dataset.stop!, s?.photos.findIndex((p) => p.id === a.dataset.photo) ?? -1, a);
  });
  a.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hidePin());
});

const touchScreen = matchMedia('(hover: none)').matches;
let cycleTimer = 0;
function startCycle(stopId: string) {
  stopCycle();
  if (!touchScreen || reduced || mobile()) return;
  const thumbs = [...document.querySelectorAll<HTMLElement>(`.thumb[data-stop="${stopId}"]`)].filter((t) => t.style.display !== 'none');
  const photos = stopById.get(stopId)!.photos;
  let k = 0;
  const next = () => {
    const t = thumbs[k % thumbs.length];
    showPin(stopId, photos.findIndex((p) => p.id === t.dataset.photo), t);
    k++;
    cycleTimer = window.setTimeout(next, 2400);
  };
  cycleTimer = window.setTimeout(next, 2800); // 지도가 도착한 뒤부터
}
function stopCycle() {
  clearTimeout(cycleTimer);
  hidePin();
}

// 날짜 표지 사진 시차: CSS 스크롤 애니메이션이 없는 브라우저(구형 사파리 등)는 스크립트로
if (!CSS.supports('animation-timeline: view()') && !reduced) {
  const imgs = [...document.querySelectorAll<HTMLElement>('.title-img')];
  let queued = false;
  const update = () => {
    queued = false;
    for (const img of imgs) {
      const r = img.parentElement!.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const p = (innerHeight - r.top) / (innerHeight + r.height); // 0 → 1
      img.style.transform = mobile() ? '' : `translateY(${(p - 0.5) * 16}%) scale(${1.06 - p * 0.06})`;
    }
  };
  addEventListener('scroll', () => !queued && ((queued = true), requestAnimationFrame(update)), { passive: true });
  update();
}

// ── 키보드(← →)로 장소 사이 이동, P 로 자동 재생 ──
function currentIndex() {
  const mid = innerHeight / 2;
  let best = 0;
  targets.forEach((t, i) => {
    if (t.getBoundingClientRect().top < mid) best = i;
  });
  return best;
}
function goto(i: number) {
  const t = targets[Math.max(0, Math.min(targets.length - 1, i))];
  const r = t.getBoundingClientRect();
  scrollTo({ top: scrollY + r.top + Math.min(r.height, innerHeight) / 2 - innerHeight / 2 + 2, behavior: reduced ? 'auto' : 'smooth' });
}
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || document.querySelector('.pswp--open')) return;
  if (e.key === 'ArrowRight' || e.key === 'j') (goto(currentIndex() + 1), e.preventDefault());
  else if (e.key === 'ArrowLeft' || e.key === 'k') (goto(currentIndex() - 1), e.preventDefault());
  else if (e.key === 'p') togglePlay();
});

// 자동 재생: 장소와 일기를 차례로 머물며 넘어간다
const playBtn = $('[data-action="play"]')!;
const stops = [...document.querySelectorAll<HTMLElement>('[data-map-target], .journal')];
let playing = false;
let playTimer = 0;
function togglePlay(force?: boolean) {
  playing = force ?? !playing;
  playBtn.setAttribute('aria-pressed', String(playing));
  playBtn.textContent = playing ? '❚❚ 잠시 멈춤' : '▶ 자동 감상';
  clearTimeout(playTimer);
  if (playing) step();
}
function step() {
  if (!playing) return;
  const mid = innerHeight / 2;
  const next = stops.find((el) => el.getBoundingClientRect().top > mid + 4);
  if (!next) return togglePlay(false);
  const r = next.getBoundingClientRect();
  const isJournal = next.classList.contains('journal');
  scrollTo({ top: scrollY + r.top - (isJournal ? 0 : innerHeight / 2 - Math.min(r.height, innerHeight) / 2), behavior: 'smooth' });
  playTimer = window.setTimeout(step, isJournal ? 9000 : next.dataset.mapTarget === 'day' ? 5000 : 6500);
}
playBtn.addEventListener('click', () => togglePlay());
for (const ev of ['wheel', 'touchstart']) addEventListener(ev, () => playing && togglePlay(false), { passive: true });

// 지도 직접 둘러보기
const exploreBtn = $('[data-action="explore"]')!;
exploreBtn.addEventListener('click', () => {
  const on = !document.body.classList.contains('exploring');
  document.body.classList.toggle('exploring', on);
  exploreBtn.setAttribute('aria-pressed', String(on));
  exploreBtn.textContent = on ? '여행기로 돌아가기' : '지도 둘러보기';
  for (const h of [map.dragPan, map.dragRotate, map.touchZoomRotate, map.doubleClickZoom]) on ? h.enable() : h.disable();
  map.scrollZoom.disable();
  if (on) togglePlay(false);
  map.stop();
  orbitFor = '';
  if (!on && activeTarget) {
    mountMap(activeTarget);
    if (activeTarget.dataset.mapTarget === 'stop') showStop(activeTarget.dataset.stopId!);
    else if (activeTarget.dataset.mapTarget === 'day') showDay(Number(activeTarget.dataset.day));
  }
});
$('[data-action="next"]')!.addEventListener('click', () => goto(currentIndex() + 1));

document.querySelectorAll<HTMLButtonElement>('.photos-toggle').forEach((button) => button.addEventListener('click', () => {
  const card = button.closest('.card')!;
  const expanded = button.getAttribute('aria-expanded') !== 'true';
  button.setAttribute('aria-expanded', String(expanded));
  card.querySelectorAll<HTMLElement>('.thumb').forEach((photo, i) => { if (i >= 6) photo.style.display = expanded ? '' : 'none'; });
  card.classList.toggle('photos-expanded', expanded);
  button.textContent = expanded ? '사진 접기 −' : `사진 ${card.querySelectorAll('.thumb').length}장 모두 펼쳐보기 +`;
}));
const shareButton = $('[data-action="share"]')!;
shareButton.addEventListener('click', async () => {
  try {
    if (navigator.share) await navigator.share({ title: document.title, url: location.href });
    else { await navigator.clipboard.writeText(location.href); shareButton.textContent = '링크 복사 완료 ✓'; setTimeout(() => { shareButton.textContent = '공유 ↗'; }, 2400); }
  } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) shareButton.textContent = '주소창 링크를 복사해주세요'; }
});
const nextGate = $('[data-auto-next]');
document.body.classList.toggle('auto-journey-off', !autoJourneyEnabled());
if (nextGate) scrollJourney(nextGate, $('.continue-link') as HTMLAnchorElement, () => autoJourneyEnabled() && !document.querySelector('.pswp--open') && !document.body.classList.contains('exploring'), { atEnd: true });
if (sessionStorage.getItem('journey-auto-entry') === location.pathname) {
  sessionStorage.removeItem('journey-auto-entry');
  document.body.classList.add('arrived-by-scroll');
}

// ── 사진 크게 보기 ──
const lightbox = new PhotoSwipeLightbox({
  gallery: '.pswp-gallery',
  children: 'a.pswp-item',
  pswpModule: () => import('photoswipe'),
  bgOpacity: 0.96,
  showHideAnimationType: 'zoom',
});
lightbox.on('beforeOpen', () => {
  togglePlay(false);
  stopCycle();
  orbitFor = '';
  map.stop();
});
lightbox.on('uiRegister', () => {
  lightbox.pswp?.ui?.registerElement({
    name: 'custom-caption',
    order: 9,
    isButton: false,
    appendTo: 'root',
    onInit: (el, pswp) => {
      pswp.on('change', () => {
        el.textContent = (pswp.currSlide?.data.element as HTMLElement | undefined)?.dataset.caption ?? '';
      });
    },
  });
});
lightbox.init();
