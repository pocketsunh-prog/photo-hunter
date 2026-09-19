/**
 * 尋物獵人 Photo Hunter - web client controller.
 *
 * Screens: home -> level select -> photo. One level = one Ghibli-style photo with
 * ten anachronistic objects; the server owns progress, the 錦囊 economy and
 * milestone rewards, while this client does the tapping, the markers and the
 * sound. Everything is fetched from the Express + MySQL API in ../server.
 */
import { api, storage, ApiError } from './api.js';
import { audio } from './audio.js';
import { hitTest, boxCenter, formatTime, formatDate } from './game.js';

const $ = (id) => document.getElementById(id);
const PHOTO_PATH = '/assets/images';

const state = {
  player: null,
  levels: [],
  level: null, // full level payload incl. objects
  sessionId: null,
  found: new Set(),
  revealed: new Set(),
  startedAt: 0,
  timerId: null,
  elapsedMs: 0,
  busy: false,
  pending: new Set(),
  hintRingTimer: null,
  currentScreen: 'home',
  lastStats: null,
};

// ─────────────────────────────────────────────────────────── screens

function showScreen(name) {
  state.currentScreen = name;
  for (const screen of document.querySelectorAll('.screen')) {
    screen.classList.toggle('is-active', screen.id === `screen-${name}`);
  }
  document.body.dataset.screen = name;
  if (name === 'level' || name === 'levels') refreshMusicButtons();
  window.scrollTo(0, 0);
  if (name === 'game' && state.level) {
    // layout must settle before the zoom layer can be measured
    requestAnimationFrame(() => requestAnimationFrame(() => {
      layoutZoomLayer();
      applyZoom();
    }));
  }
}

function showModal(id) {
  closeModal();
  $('modalBackdrop').hidden = false;
  $(id).hidden = false;
}

function closeModal() {
  $('modalBackdrop').hidden = true;
  for (const modal of document.querySelectorAll('.modal')) modal.hidden = true;
}

function toast(message, kind = 'good', ms = 2600) {
  const el = document.createElement('div');
  el.className = `toast is-${kind}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 320);
  }, ms);
}

// ─────────────────────────────────────────────────────────── boot

async function boot() {
  wireStaticHandlers();
  refreshMusicButtons();

  try {
    const health = await api.health();
    const { chapters, objects } = health.database;
    $('homeServerNote').textContent = `已連線 MySQL：${chapters} 章 · ${objects} 件物品`;
    $('homeServerNote').classList.remove('is-error');
  } catch (error) {
    $('homeServerNote').textContent = '連不上伺服器或 MySQL，請先啟動：docker compose up -d db';
    $('homeServerNote').classList.add('is-error');
  }

  const storedNickname = storage.nickname;
  if (storedNickname) $('nicknameInput').value = storedNickname;

  if (storage.playerKey) {
    try {
      const profile = await api.getPlayer(storage.playerKey);
      state.player = profile.player;
      renderHomeStats();
    } catch (error) {
      if (error.status === 404) storage.playerKey = null;
      else console.warn('[boot] profile load failed', error);
    }
  }
  showScreen('home');
}

function renderHomeStats() {
  const cleared = state.player?.levelsCleared ?? 0;
  $('homeHintsChip').textContent = `錦囊 ×${state.player?.hints ?? 3}`;
  $('homeProgressChip').textContent = `已過 ${cleared} 章`;
}

/**
 * Sign in by nickname. The name IS the account: the same name always resumes the
 * same progress, 錦囊 and score records (on any browser or device), and a new
 * name creates a fresh account.
 */
async function ensurePlayer(nickname) {
  const response = await api.createPlayer(nickname);
  state.player = response.player;
  storage.playerKey = response.player.playerKey;
  storage.nickname = response.player.nickname;
  return { player: response.player, isNew: response.existing === false };
}

// ─────────────────────────────────────────────────────────── level select

async function refreshLevels() {
  const response = await api.listLevels(storage.playerKey);
  state.levels = response.levels;
  return state.levels;
}

function renderLevels() {
  const grid = $('levelGrid');
  grid.innerHTML = '';

  const clearedChapters = state.levels.filter((l) => l.progress?.completed).length;
  const totalObjects = state.levels.reduce((sum, l) => sum + l.objectCount, 0);
  // A cleared chapter always reads as full, even if the player replayed it and
  // left the photo half-finished.
  const foundOf = (level) => (level.progress?.completed ? level.objectCount : level.progress?.foundCount ?? 0);
  const foundObjects = state.levels.reduce((sum, l) => sum + foundOf(l), 0);
  $('statRow').innerHTML = `
    <div class="stat"><b>${state.player?.hints ?? 0}</b><span>錦囊</span></div>
    <div class="stat"><b>${clearedChapters}/${state.levels.length}</b><span>已破章節</span></div>
    <div class="stat"><b>${foundObjects}/${totalObjects}</b><span>已找到目標</span></div>
  `;
  $('levelsSubtitle').textContent = `共 ${state.levels.length} 章 · 每章 10 件`;
  $('levelsHintsChip').textContent = `錦囊 ×${state.player?.hints ?? 0}`;

  let lastCollection = null;
  for (const level of state.levels) {
    // Section header whenever the volume changes (卷一 / 卷二).
    if (level.collection && level.collection !== lastCollection) {
      lastCollection = level.collection;
      const header = document.createElement('div');
      header.className = 'level-section';
      const cleared = state.levels.filter((l) => l.collection === level.collection && l.progress?.completed).length;
      const total = state.levels.filter((l) => l.collection === level.collection).length;
      header.innerHTML = `<b>${level.collection}</b><span>${cleared}/${total} 章已破</span>`;
      grid.appendChild(header);
    }
    const progress = level.progress;
    const foundCount = foundOf(level);
    const card = document.createElement('button');
    card.type = 'button';
    const locked = level.locked === true;
    card.className = `level-card${progress?.completed ? ' is-done' : ''}${locked ? ' is-locked' : ''}`;
    card.disabled = locked;
    card.innerHTML = `
      <div class="level-thumb">
        <img src="${PHOTO_PATH}/${level.thumb}" alt="${level.title}" loading="lazy" draggable="false">
        <span class="level-index">第 ${level.id} 章</span>
        ${progress?.completed ? '<span class="level-badge">✓ 已破</span>' : ''}
        ${locked ? `<span class="level-lock">🔒 先完成第 ${level.requiresLevel} 章</span>` : ''}
      </div>
      <div class="level-meta">
        <b>${level.title}</b>
        <span class="era">${locked ? '尚未解鎖' : level.era}</span>
        <div class="level-bar"><i style="width:${locked ? 0 : (foundCount / level.objectCount) * 100}%"></i></div>
        <span class="level-progress-text">${locked ? `完成第 ${level.requiresLevel} 章即可進入` : `${foundCount}/${level.objectCount}${
          progress?.bestMs ? ` · 最佳 ${formatTime(progress.bestMs)}` : ''
        }`}</span>
      </div>`;
    if (!locked) {
      card.addEventListener('click', () => {
        audio.play('click');
        openLevel(level.id).catch(handleFatal);
      });
    }
    grid.appendChild(card);
  }
}

// ─────────────────────────────────────────────────────────── level play

async function openLevel(levelId, { restart = false } = {}) {
  if (state.busy) return;
  state.busy = true;
  closeModal();
  showScreen('game');
  $('photoVeil').hidden = false;
  $('photoImg').classList.add('is-hidden');

  try {
    const start = await api.startLevel(storage.playerKey, levelId, { restart });
    state.level = start.level;
    state.sessionId = start.sessionId;
    state.player = start.player;
    state.found = new Set(start.progress?.found ?? []);
    state.revealed = new Set();
    state.pending.clear();
    state.wrongTaps = start.progress?.wrongTaps ?? 0;
    state.elapsedMs = 0;
    state.startedAt = Date.now();

    $('gameTitle').textContent = start.level.title;
    $('gameEra').textContent = `${start.level.era}${start.level.subtitle ? ` · ${start.level.subtitle}` : ''}`;
    clearHintRing();

    const img = $('photoImg');
    img.classList.add('is-hidden');
    resetZoom();
    const prepareStage = () => {
      img.classList.remove('is-hidden');
      $('photoVeil').hidden = true;
      layoutZoomLayer();
      resetZoom();
    };
    img.onload = prepareStage;
    img.onerror = () => {
      $('photoVeil').hidden = true;
      toast('相片載入失敗，請稍後再試。', 'bad');
    };
    img.src = `${PHOTO_PATH}/${start.level.image}`;
    if (img.complete && img.naturalWidth) {
      requestAnimationFrame(prepareStage);
    }

    renderHud();
    renderPips();
    renderFoundStrip();
    renderMarkers();
    startTimer();
    audio.playBgm('game');
    if (restart) toast('重新開始本章。', 'info', 1800);
    if (state.found.size) toast(`已找回 ${state.found.size} 件，繼續找剩下的。`, 'info', 2200);
  } finally {
    state.busy = false;
  }
}

function startTimer() {
  stopTimer();
  state.timerId = window.setInterval(() => {
    state.elapsedMs = Date.now() - state.startedAt;
    $('gameTimer').textContent = formatTime(state.elapsedMs);
  }, 250);
  $('gameTimer').textContent = '00:00';
}

function stopTimer() {
  if (state.timerId) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
  state.elapsedMs = Date.now() - state.startedAt;
}

function renderHud() {
  const total = state.level?.objectCount ?? 10;
  $('foundCount').textContent = state.found.size;
  $('foundCount').parentElement.querySelector('i').textContent = `/${total}`;
  $('hintCount').textContent = state.player?.hints ?? 0;
  $('btnHint').disabled = (state.player?.hints ?? 0) < 1;
}

function renderPips() {
  const total = state.level?.objectCount ?? 10;
  const pips = $('pips');
  pips.innerHTML = '';
  for (let i = 0; i < total; i += 1) {
    const pip = document.createElement('span');
    pip.className = 'pip';
    pips.appendChild(pip);
  }
  updatePips();
}

function updatePips() {
  const objects = state.level?.objects ?? [];
  const pips = [...$('pips').children];
  objects.forEach((object, index) => {
    const pip = pips[index];
    if (!pip) return;
    pip.classList.toggle('is-found', state.found.has(object.id));
    pip.classList.toggle('is-revealed', state.found.has(object.id) && state.revealed.has(object.id));
  });
}

function renderFoundStrip() {
  const strip = $('foundStrip');
  strip.innerHTML = '';
  for (const object of state.level?.objects ?? []) {
    const found = state.found.has(object.id);
    const slot = document.createElement('div');
    slot.className = `slot${found ? (state.revealed.has(object.id) ? ' is-revealed' : ' is-found') : ''}`;
    slot.textContent = found ? object.name : '？？？';
    if (found) {
      slot.title = '點一下看它為什麼不屬於這個年代';
      slot.addEventListener('click', () => toast(`${object.name}：${object.reason}`, 'info', 4200));
    }
    strip.appendChild(slot);
  }
}

/**
 * Zoomable photo.
 *
 * The photo, the found markers and the tap effects all live inside #zoomLayer,
 * so one CSS transform zooms them together and the markers stay glued to their
 * objects. The layer is sized to the letterboxed image box, which means taps can
 * still be normalised with a plain getBoundingClientRect() even while zoomed.
 */
const zoom = {
  scale: 1,
  x: 0,
  y: 0,
  min: 1,
  max: 4,
  pointers: new Map(),
  panning: false,
  moved: 0,
  downAt: 0,
  pinched: false,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Size #zoomLayer to the biggest 3:4-ish box that fits the stage. */
function layoutZoomLayer() {
  const stage = $('photoStage');
  const level = state.level;
  if (!stage || !level) return;
  const aspect = (level.imageWidth || 1440) / (level.imageHeight || 1920);
  const availW = Math.max(1, stage.clientWidth);
  const availH = Math.max(1, stage.clientHeight);
  let width = availW;
  let height = availW / aspect;
  if (height > availH) {
    height = availH;
    width = availH * aspect;
  }
  const layer = $('zoomLayer');
  layer.style.width = `${Math.round(width)}px`;
  layer.style.height = `${Math.round(height)}px`;
}

function layerSize() {
  const layer = $('markerLayer');
  return { w: layer.clientWidth || 1, h: layer.clientHeight || 1 };
}

/** Keep the photo covering the stage: never allow empty space around it. */
function clampZoomPan() {
  const layer = $('zoomLayer');
  const width = layer.clientWidth || 1;
  const height = layer.clientHeight || 1;
  zoom.x = clamp(zoom.x, -(zoom.scale - 1) * width, 0);
  zoom.y = clamp(zoom.y, -(zoom.scale - 1) * height, 0);
}

function applyZoom() {
  const layer = $('zoomLayer');
  if (!layer) return;
  zoom.scale = clamp(zoom.scale, zoom.min, zoom.max);
  clampZoomPan();
  layer.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`;
  // Markers/labels use these so their text keeps a constant screen size.
  layer.style.setProperty('--z', String(zoom.scale));
  layer.style.setProperty('--inv', String(1 / zoom.scale));
  $('btnZoomReset').textContent = `${Math.round(zoom.scale * 100)}%`;
  $('btnZoomOut').disabled = zoom.scale <= zoom.min + 0.001;
  $('btnZoomIn').disabled = zoom.scale >= zoom.max - 0.001;
  $('photoStage').classList.toggle('is-zoomed', zoom.scale > 1.001);
  renderMarkers();
}

/** Zoom by `factor`, keeping the photo point under (clientX, clientY) fixed. */
function zoomAt(clientX, clientY, factor) {
  const layer = $('zoomLayer');
  if (!layer.clientWidth) return;
  const rect = layer.getBoundingClientRect();
  // The element is laid out centred in the stage; translate() moves it from there.
  const baseLeft = rect.left - zoom.x;
  const baseTop = rect.top - zoom.y;
  const localX = (clientX - baseLeft - zoom.x) / zoom.scale;
  const localY = (clientY - baseTop - zoom.y) / zoom.scale;
  const next = clamp(zoom.scale * factor, zoom.min, zoom.max);
  if (next === zoom.scale) return;
  zoom.x = clientX - baseLeft - localX * next;
  zoom.y = clientY - baseTop - localY * next;
  zoom.scale = next;
  applyZoom();
}

function resetZoom() {
  zoom.scale = 1;
  zoom.x = 0;
  zoom.y = 0;
  applyZoom();
}

function zoomStep(factor) {
  const stage = $('photoStage');
  const rect = stage.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
}

function renderMarkers() {
  const layer = $('markerLayer');
  layer.innerHTML = '';
  const { w: layerW, h: layerH } = layerSize();
  const objects = state.level?.objects ?? [];
  // Marker rings keep at least this many *screen* pixels by shrinking the
  // floor as the photo is zoomed in, so a ring never balloons over its object.
  const minScreenPx = 42 / zoom.scale;

  objects.forEach((object, index) => {
    if (!state.found.has(object.id)) return;
    const [cx, cy] = boxCenter(object.bbox);
    const [bx, by, bw, bh] = object.bbox;
    const width = Math.max(bw * layerW, minScreenPx);
    const height = Math.max(bh * layerH, minScreenPx);
    const marker = document.createElement('div');
    marker.className = `marker${state.revealed.has(object.id) ? ' is-revealed' : ''}`;
    marker.dataset.index = String(index + 1);
    marker.style.left = `${cx * layerW}px`;
    marker.style.top = `${cy * layerH}px`;
    marker.style.width = `${width}px`;
    marker.style.height = `${height}px`;

    const label = document.createElement('span');
    label.className = 'marker-label';
    label.textContent = `${index + 1}. ${object.name}`;
    const belowRoom = cy * layerH + height / 2 + 34 < layerH;
    label.style.top = belowRoom ? `${height / 2}px` : `${-height / 2 - 26}px`;
    marker.appendChild(label);
    layer.appendChild(marker);
  });
}

function tapFx(nx, ny, kind) {
  const { w: layerW, h: layerH } = layerSize();
  const el = document.createElement('div');
  el.className = `tap-fx ${kind}`;
  el.style.left = `${nx * layerW}px`;
  el.style.top = `${ny * layerH}px`;
  $('fxLayer').appendChild(el);
  setTimeout(() => el.remove(), 800);
}

function showHintRing(object) {
  clearHintRing();
  const { w: layerW, h: layerH } = layerSize();
  const [cx, cy] = boxCenter(object.bbox);
  const [bx, by, bw, bh] = object.bbox;
  const ring = document.createElement('div');
  ring.className = 'hint-ring';
  ring.style.left = `${cx * layerW}px`;
  ring.style.top = `${cy * layerH}px`;
  ring.style.width = `${Math.max(bw * layerW * 1.5, 84 / zoom.scale)}px`;
  ring.style.height = `${Math.max(bh * layerH * 1.5, 84 / zoom.scale)}px`;
  $('fxLayer').appendChild(ring);
  state.hintRingTimer = window.setTimeout(() => {
    ring.remove();
    state.hintRingTimer = null;
  }, 5000);
}

function clearHintRing() {
  if (state.hintRingTimer) {
    window.clearTimeout(state.hintRingTimer);
    state.hintRingTimer = null;
  }
  for (const ring of document.querySelectorAll('.hint-ring')) ring.remove();
}

// ─────────────────────────────────────────────────────────── zoom gestures

function onStagePointerDown(event) {
  if (state.currentScreen !== 'game' || !state.level) return;
  // The zoom buttons live inside the stage; capturing the pointer there would
  // swallow their click events (and later count as a tap on the photo).
  if (event.target?.closest?.('.zoom-controls')) return;
  const stage = $('photoStage');
  try {
    stage.setPointerCapture?.(event.pointerId);
  } catch {
    /* synthetic or already-released pointer - capture is only an optimisation */
  }
  zoom.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (zoom.pointers.size === 1) {
    zoom.moved = 0;
    zoom.downAt = Date.now();
    zoom.pinched = false;
    zoom.panning = zoom.scale > 1.001;
    if (zoom.panning) stage.classList.add('is-panning');
  } else {
    // A second finger means this is a pinch, never a tap.
    zoom.pinched = true;
  }
}

function onStagePointerMove(event) {
  const previous = zoom.pointers.get(event.pointerId);
  if (!previous) return;
  const current = { x: event.clientX, y: event.clientY };
  zoom.pointers.set(event.pointerId, current);

  if (zoom.pointers.size === 1) {
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    zoom.moved += Math.hypot(dx, dy);
    if (zoom.scale > 1.001 && zoom.moved > 3) {
      event.preventDefault();
      zoom.x += dx;
      zoom.y += dy;
      applyZoom();
    }
    return;
  }

  if (zoom.pointers.size === 2) {
    event.preventDefault();
    const [a, b] = [...zoom.pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (zoom.pinchDistance) {
      const centreX = (a.x + b.x) / 2;
      const centreY = (a.y + b.y) / 2;
      zoomAt(centreX, centreY, distance / zoom.pinchDistance);
    }
    zoom.pinchDistance = distance;
  }
}

function onStagePointerUp(event) {
  const start = zoom.pointers.get(event.pointerId);
  const wasSingle = zoom.pointers.size === 1;
  zoom.pointers.delete(event.pointerId);
  $('photoStage').classList.remove('is-panning');
  if (zoom.pointers.size < 2) zoom.pinchDistance = null;

  // A tap is a short, still press with one finger - everything else is a gesture.
  if (!wasSingle || !start || zoom.pinched) return;
  const still = Math.hypot(event.clientX - start.x, event.clientY - start.y) < 10 && zoom.moved < 12;
  const quick = Date.now() - zoom.downAt < 700;
  if (still && quick) handlePhotoTap(event.clientX, event.clientY);
}

function onStageWheel(event) {
  if (state.currentScreen !== 'game' || !state.level) return;
  event.preventDefault();
  zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0016));
}

function onStageDoubleClick(event) {
  if (state.currentScreen !== 'game' || !state.level) return;
  event.preventDefault();
  if (zoom.scale > 1.001) resetZoom();
  else zoomAt(event.clientX, event.clientY, 2.5);
}

// ─────────────────────────────────────────────────────────── tapping

/** Turn a screen position into normalised photo coordinates and test the boxes. */
function handlePhotoTap(clientX, clientY) {
  if (state.currentScreen !== 'game' || !state.level) return;
  const img = $('photoImg');
  if (!img.naturalWidth) return;
  const rect = img.getBoundingClientRect();
  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top) / rect.height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return; // letterbox area, not the photo

  const candidates = state.level.objects.filter((o) => !state.found.has(o.id) && !state.pending.has(o.id));
  const hit = hitTest(candidates, nx, ny);
  if (hit) registerFound(hit, nx, ny, 'tap');
  else registerMiss(nx, ny);
}

async function registerFound(object, nx, ny, source) {
  state.pending.add(object.id);
  state.found.add(object.id);
  if (source === 'hint-reveal') state.revealed.add(object.id);
  audio.play('found');
  tapFx(nx, ny, 'hit');
  renderHud();
  updatePips();
  renderFoundStrip();
  renderMarkers();

  try {
    const response = await api.found(storage.playerKey, state.level.id, {
      objectId: object.id,
      sessionId: state.sessionId,
      elapsedMs: state.elapsedMs,
    });
    state.player = response.player;
    state.found = new Set(response.found);
    renderHud();
    updatePips();
    renderFoundStrip();
    renderMarkers();
    if (response.completed) await onLevelComplete(response);
    else toast(`找到了：${object.name}（${state.found.size}/${state.level.objectCount}）`, 'good', 2000);
  } catch (error) {
    state.pending.delete(object.id);
    if (error instanceof ApiError && error.status === 409) return;
    state.found.delete(object.id);
    renderHud();
    updatePips();
    renderFoundStrip();
    renderMarkers();
    toast(error.message || '記錄失敗，請再試一次。', 'bad');
  } finally {
    state.pending.delete(object.id);
  }
}

async function registerMiss(nx, ny) {
  audio.play('wrong', { volume: 0.7 });
  tapFx(nx, ny, 'miss');
  state.wrongTaps += 1;
  try {
    await api.miss(storage.playerKey, state.level.id, { sessionId: state.sessionId });
  } catch {
    /* stats only - a failed miss must never interrupt play */
  }
}

// ─────────────────────────────────────────────────────────── hints

async function useHint(mode) {
  closeModal();
  if (!state.level || state.busy) return;
  if ((state.player?.hints ?? 0) < 1) {
    toast('錦囊已用完，完成 5 關可再獲得 3 個。', 'bad');
    return;
  }
  state.busy = true;
  audio.play('hint');
  try {
    const response = await api.hint(storage.playerKey, state.level.id, {
      mode,
      sessionId: state.sessionId,
      elapsedMs: state.elapsedMs,
    });
    state.player = response.player;

    if (mode === 'reveal' && response.object) {
      state.found = new Set(response.found);
      state.revealed.add(response.object.id);
      audio.play('found');
      const [cx, cy] = boxCenter(response.object.bbox);
      tapFx(cx, cy, 'hit');
      toast(`錦囊替你找出了「${response.object.name}」。`, 'good', 3200);
      renderHud();
      updatePips();
      renderFoundStrip();
      renderMarkers();
      if (response.completed) await onLevelComplete(response);
    } else if (response.object) {
      showHintRing(response.object);
      toast(`錦囊指路：${response.object.hint}`, 'info', 5200);
      renderHud();
    }
    if (response.reward?.awarded) {
      audio.play('bonus');
      toast(response.reward.message, 'good', 4200);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) toast(error.message, 'bad');
    else toast(error.message || '錦囊用不了，請再試一次。', 'bad');
  } finally {
    state.busy = false;
    renderHud();
  }
}

// ─────────────────────────────────────────────────────────── completion

async function onLevelComplete(response) {
  stopTimer();
  clearHintRing();
  audio.play('levelClear');
  const stats = {
    levelId: state.level.id,
    title: state.level.title,
    durationMs: response.durationMs ?? state.elapsedMs,
    // The session numbers describe THIS run; progress.* would be cumulative
    // across every attempt at the chapter.
    hintsUsed: response.record?.hintsUsed ?? response.progress?.hintsUsed ?? 0,
    wrongTaps: response.record?.wrongTaps ?? response.progress?.wrongTaps ?? 0,
    record: response.record ?? null,
    reward: response.reward ?? { awarded: 0 },
    player: response.player,
  };
  state.lastStats = stats;

  try {
    await refreshLevels();
  } catch {
    /* the clear modal is more important than a fresh level list */
  }
  const completedChapters = state.levels.filter((l) => l.progress?.completed).length;
  renderHomeStats();

  if (completedChapters >= state.levels.length) {
    window.setTimeout(() => showGameClear(stats), 900);
    return;
  }
  window.setTimeout(() => showClearModal(stats), 700);
}

function showClearModal(stats) {
  $('clearEyebrow').textContent = `第 ${stats.levelId} 章 完成`;
  $('clearTitle').textContent = `${stats.title} · 十個目標全數尋獲`;
  const score = stats.record?.chapterScoreMs;
  $('clearStats').innerHTML = `
    <div class="stat"><b>${formatTime(stats.durationMs)}</b><span>用時</span></div>
    <div class="stat"><b>${stats.wrongTaps}</b><span>誤點</span></div>
    <div class="stat"><b>${stats.hintsUsed}</b><span>錦囊</span></div>
    ${Number.isFinite(score) ? `<div class="stat"><b>${formatTime(score)}</b><span>本章成績</span></div>` : ''}`;

  const bestNote = $('clearBestNote');
  if (stats.record?.isNewBest) {
    bestNote.hidden = false;
    bestNote.textContent = '⚡ 本章最快紀錄！';
  } else if (Number.isFinite(stats.record?.previousBestMs)) {
    bestNote.hidden = false;
    bestNote.textContent = `本章最佳 ${formatTime(stats.record.previousBestMs)}（成績含誤點罰時）`;
  } else {
    bestNote.hidden = true;
  }

  const rewardBox = $('clearReward');
  if (stats.reward?.awarded) {
    rewardBox.hidden = false;
    rewardBox.textContent = `${stats.reward.message}（目前錦囊 ×${stats.player?.hints ?? 0}）`;
    window.setTimeout(() => audio.play('bonus'), 260);
  } else {
    rewardBox.hidden = true;
  }

  const index = state.levels.findIndex((l) => l.id === stats.levelId);
  const next = state.levels[index + 1];
  const nextBtn = $('btnNextLevel');
  nextBtn.textContent = next ? `前往第 ${next.id} 章` : '回到選關';
  nextBtn.dataset.next = next ? String(next.id) : '';
  showModal('modalClear');
}

function showGameClear(stats) {
  audio.play('gameClear');
  const cleared = state.levels.filter((l) => l.progress?.completed);
  const totalMs = cleared.reduce((sum, l) => sum + (l.progress?.bestMs ?? 0), 0);
  const hints = state.player?.hintsSpent ?? 0;
  $('gameClearStats').innerHTML = `
    <div class="stat"><b>10/10</b><span>章節</span></div>
    <div class="stat"><b>${formatTime(totalMs)}</b><span>總用時</span></div>
    <div class="stat"><b>${hints}</b><span>用掉錦囊</span></div>`;
  showModal('modalGameClear');
}

function leaveLevel() {
  stopTimer();
  clearHintRing();
  renderHomeStats();
  audio.playBgm('menu');
  refreshLevels()
    .then(renderLevels)
    .catch(() => {})
    .finally(() => showScreen('levels'));
}

// ─────────────────────────────────────────────────────────── reset

/**
 * Wipe this player's own environment: progress, every attempt (so the
 * leaderboard entry goes away) and the 錦囊 audit trail. The playerKey and
 * nickname stay, so the browser keeps the same identity.
 */
async function resetGame() {
  if (!storage.playerKey) {
    toast('還沒有建立角色。', 'bad');
    return;
  }
  const confirmButton = $('btnResetConfirm');
  confirmButton.disabled = true;
  try {
    const response = await api.resetPlayer(storage.playerKey);
    state.player = response.player;
    state.lastStats = null;
    state.found = new Set();
    state.revealed = new Set();
    await refreshLevels();
    renderLevels();
    renderHomeStats();
    audio.play('bonus');
    closeModal();
    toast(response.message || '已重置遊戲進度。', 'info', 4200);
  } catch (error) {
    toast(error.message || '重置失敗，請再試一次。', 'bad', 4200);
  } finally {
    confirmButton.disabled = false;
  }
}

function openResetDialog() {
  audio.play('click');
  const cleared = state.levels.filter((l) => l.progress?.completed).length;
  const found = state.levels.reduce((sum, l) => sum + (l.progress?.foundCount ?? 0), 0);
  $('resetSummary').innerHTML = `
    <li>目前的 <b>${cleared}/${state.levels.length}</b> 章進度與 <b>${found}</b> 件已找到的物件</li>
    <li>排行榜上的成績與最佳時間</li>
    <li>錦囊的使用與獲得紀錄（目前 ×${state.player?.hints ?? 0}）</li>`;
  showModal('modalReset');
}

// ─────────────────────────────────────────────────────────── leaderboard

async function openLeaderboard() {
  audio.play('click');
  showModal('modalLeaderboard');
  $('boardBody').innerHTML = '<p class="modal-text">載入中…</p>';
  try {
    const { leaderboard, scoring } = await api.leaderboard(20);
    let myLine = '';
    if (storage.playerKey) {
      try {
        const mine = await api.myRank(storage.playerKey);
        myLine = mine?.rank
          ? `<p class="board-me">你的排名：第 ${mine.rank.rank} 名 · 成績 ${formatTime(mine.rank.scoreMs)}（${mine.rank.chapters} 章 · 誤點 ${mine.rank.wrongTaps}）</p>`
          : '<p class="board-me">你還沒有完成任何章節，先破第 1 章就會上榜。</p>';
      } catch {
        /* the board itself is more important than the personal line */
      }
    }
    const rule = scoring
      ? `<p class="board-rule">成績 = 每章最快一次（用時 + 誤點 × ${Math.round(
          scoring.wrongTapPenaltyMs / 1000,
        )} 秒）加總，數字越小越好；同分先比誤點，再比用時。</p>`
      : '';
    if (!leaderboard.length) {
      $('boardBody').innerHTML = `${rule}${myLine}<p class="modal-text">還沒有人破關，你可以是第一個。</p>`;
      return;
    }
    const myNickname = state.player?.nickname;
    const rows = leaderboard
      .map(
        (row) => `<tr class="${row.nickname === myNickname ? 'is-me' : ''}">
          <td class="rank">${row.rank}</td>
          <td>${escapeHtml(row.nickname)}</td>
          <td>${row.chapters}</td>
          <td class="score">${formatTime(row.scoreMs)}</td>
          <td>${formatTime(row.timeMs)}</td>
          <td class="${row.wrongTaps === 0 ? 'clean' : ''}">${row.wrongTaps}</td>
          <td>${row.hintsUsed}</td>
        </tr>`,
      )
      .join('');
    $('boardBody').innerHTML = `${rule}<table>
      <thead><tr><th>#</th><th>名號</th><th>章節</th><th>成績</th><th>總用時</th><th>誤點</th><th>錦囊</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  } catch (error) {
    $('boardBody').innerHTML = `<p class="modal-text">讀取排行榜失敗：${escapeHtml(error.message)}</p>`;
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ─────────────────────────────────────────────────────────── music buttons

function refreshMusicButtons() {
  const muted = audio.isMuted;
  for (const id of ['btnMusicHome', 'btnMusicLevels', 'btnMusicGame']) {
    const btn = $(id);
    if (!btn) continue;
    btn.classList.toggle('is-off', muted);
    btn.setAttribute('aria-pressed', String(!muted));
    if (btn.classList.contains('chip')) btn.textContent = muted ? '♪ 背景音樂：關' : '♪ 背景音樂：開';
  }
}

function toggleMusic() {
  const muted = audio.toggleMuted();
  refreshMusicButtons();
  if (!muted) {
    audio.play('click');
    audio.playBgm(state.currentScreen === 'game' && state.level ? 'game' : 'menu');
  }
  toast(muted ? '背景音樂已關閉' : '背景音樂已開啟', 'info', 1500);
}

// ─────────────────────────────────────────────────────────── wiring

function wireStaticHandlers() {
  // Any first gesture unlocks WebAudio (browser autoplay policy).
  const unlock = () => {
    audio.unlock().then(() => {
      audio.playBgm(state.currentScreen === 'game' ? 'game' : 'menu');
    });
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });

  $('btnStart').addEventListener('click', async () => {
    const nickname = $('nicknameInput').value.trim();
    $('btnStart').disabled = true;
    try {
      await audio.unlock();
      const { player, isNew } = await ensurePlayer(nickname);
      await refreshLevels();
      renderLevels();
      renderHomeStats();
      audio.playBgm('menu');
      showScreen('levels');
      if (isNew) toast(`新帳號「${player.nickname}」已建立，錦囊 ×${player.hints}。`, 'good', 3200);
      else toast(`歡迎回來，${player.nickname}（已破 ${player.levelsCleared} 章 · 錦囊 ×${player.hints}）`, 'info', 3200);
    } catch (error) {
      toast(error.message || '無法開始遊戲。', 'bad', 4000);
    } finally {
      $('btnStart').disabled = false;
    }
  });

  $('nicknameInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('btnStart').click();
  });

  $('btnLeaderboard').addEventListener('click', openLeaderboard);
  $('btnResetGame').addEventListener('click', openResetDialog);
  $('btnResetHome').addEventListener('click', openResetDialog);
  $('btnResetConfirm').addEventListener('click', resetGame);
  $('btnGameClearBoard').addEventListener('click', () => {
    closeModal();
    openLeaderboard();
  });
  $('btnHelp').addEventListener('click', () => showModal('modalHelp'));
  $('btnLevelsBack').addEventListener('click', () => {
    audio.play('click');
    showScreen('home');
  });

  for (const id of ['btnMusicHome', 'btnMusicLevels', 'btnMusicGame']) {
    $(id).addEventListener('click', toggleMusic);
  }

  const stage = $('photoStage');
  stage.addEventListener('pointerdown', onStagePointerDown);
  stage.addEventListener('pointermove', onStagePointerMove);
  stage.addEventListener('pointerup', onStagePointerUp);
  stage.addEventListener('pointercancel', onStagePointerUp);
  stage.addEventListener('wheel', onStageWheel, { passive: false });
  stage.addEventListener('dblclick', onStageDoubleClick);
  stage.addEventListener('contextmenu', (event) => event.preventDefault());

  $('btnZoomIn').addEventListener('click', () => zoomStep(1.35));
  $('btnZoomOut').addEventListener('click', () => zoomStep(1 / 1.35));
  $('btnZoomReset').addEventListener('click', () => resetZoom());

  $('btnHint').addEventListener('click', () => {
    if ((state.player?.hints ?? 0) < 1) {
      toast('錦囊已用完，完成 5 關可再獲得 3 個。', 'bad');
      return;
    }
    audio.play('click');
    $('hintFoot').textContent = `剩餘錦囊：${state.player?.hints ?? 0}`;
    showModal('modalHint');
  });

  for (const option of document.querySelectorAll('[data-hint-mode]')) {
    option.addEventListener('click', () => useHint(option.dataset.hintMode));
  }
  for (const button of document.querySelectorAll('[data-close-modal]')) {
    button.addEventListener('click', closeModal);
  }
  $('modalBackdrop').addEventListener('click', closeModal);

  $('btnLeaveLevel').addEventListener('click', () => {
    audio.play('click');
    leaveLevel();
  });

  $('btnNextLevel').addEventListener('click', (event) => {
    const next = event.currentTarget.dataset.next;
    closeModal();
    if (next) openLevel(Number(next)).catch(handleFatal);
    else leaveLevel();
  });
  $('btnReplayLevel').addEventListener('click', () => {
    const id = state.lastStats?.levelId ?? state.level?.id;
    closeModal();
    if (id) openLevel(id, { restart: true }).catch(handleFatal);
  });
  $('btnClearToMap').addEventListener('click', () => {
    closeModal();
    leaveLevel();
  });
  $('btnGameClearMap').addEventListener('click', () => {
    closeModal();
    leaveLevel();
  });

  // Re-fit the photo box on any layout change; the zoom transform is kept, so a
  // rotated phone stays where the player was looking.
  const relayout = () => {
    layoutZoomLayer();
    applyZoom();
  };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => window.setTimeout(relayout, 250));
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(relayout);
    observer.observe($('photoStage'));
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.currentScreen !== 'game') audio.playBgm('menu');
  });
}

function handleFatal(error) {
  console.error(error);
  toast(error?.message || '發生錯誤，請重新載入。', 'bad', 4000);
}

boot().catch(handleFatal);
