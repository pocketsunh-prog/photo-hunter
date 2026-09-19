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
    // layout must settle before the marker overlay can be aligned to the photo
    requestAnimationFrame(() => requestAnimationFrame(syncOverlay));
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

async function ensurePlayer(nickname) {
  const key = storage.playerKey;
  if (key) {
    try {
      const profile = await api.getPlayer(key);
      state.player = profile.player;
      if (nickname && nickname !== state.player.nickname) {
        const renamed = await api.renamePlayer(key, nickname);
        state.player = renamed.player;
      }
      storage.nickname = state.player.nickname;
      return state.player;
    } catch (error) {
      if (error.status !== 404) throw error;
      storage.playerKey = null;
    }
  }
  const created = await api.createPlayer(nickname);
  state.player = created.player;
  storage.playerKey = created.player.playerKey;
  storage.nickname = created.player.nickname;
  return state.player;
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
    <div class="stat"><b>${foundObjects}/${totalObjects}</b><span>已找到物件</span></div>
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
    card.className = `level-card${progress?.completed ? ' is-done' : ''}`;
    card.innerHTML = `
      <div class="level-thumb">
        <img src="${PHOTO_PATH}/${level.thumb}" alt="${level.title}" loading="lazy" draggable="false">
        <span class="level-index">第 ${level.id} 章</span>
        ${progress?.completed ? '<span class="level-badge">✓ 已破</span>' : ''}
      </div>
      <div class="level-meta">
        <b>${level.title}</b>
        <span class="era">${level.era}</span>
        <div class="level-bar"><i style="width:${(foundCount / level.objectCount) * 100}%"></i></div>
        <span class="level-progress-text">${foundCount}/${level.objectCount}${
          progress?.bestMs ? ` · 最佳 ${formatTime(progress.bestMs)}` : ''
        }</span>
      </div>`;
    card.addEventListener('click', () => {
      audio.play('click');
      openLevel(level.id).catch(handleFatal);
    });
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
    img.onload = () => {
      img.classList.remove('is-hidden');
      $('photoVeil').hidden = true;
      syncOverlay();
      renderMarkers();
    };
    img.onerror = () => {
      $('photoVeil').hidden = true;
      toast('相片載入失敗，請稍後再試。', 'bad');
    };
    img.src = `${PHOTO_PATH}/${start.level.image}`;
    if (img.complete && img.naturalWidth) {
      img.classList.remove('is-hidden');
      $('photoVeil').hidden = true;
      requestAnimationFrame(syncOverlay);
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

/** Align the marker overlay exactly with the letterboxed <img>. */
function syncOverlay() {
  const img = $('photoImg');
  const stage = $('photoStage');
  if (!img || !stage || !img.naturalWidth) return;
  const rect = img.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  for (const layer of [$('markerLayer'), $('fxLayer')]) {
    layer.style.left = `${rect.left - stageRect.left}px`;
    layer.style.top = `${rect.top - stageRect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
  }
}

function layerSize() {
  const layer = $('markerLayer');
  return { w: layer.clientWidth || 1, h: layer.clientHeight || 1 };
}

function renderMarkers() {
  const layer = $('markerLayer');
  layer.innerHTML = '';
  const { w: layerW, h: layerH } = layerSize();
  const objects = state.level?.objects ?? [];

  objects.forEach((object, index) => {
    if (!state.found.has(object.id)) return;
    const [cx, cy] = boxCenter(object.bbox);
    const [bx, by, bw, bh] = object.bbox;
    const width = Math.max(bw * layerW, 42);
    const height = Math.max(bh * layerH, 42);
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
    label.style.transform = 'translate(-50%, 0)';
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
  ring.style.width = `${Math.max(bw * layerW * 1.5, 84)}px`;
  ring.style.height = `${Math.max(bh * layerH * 1.5, 84)}px`;
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

// ─────────────────────────────────────────────────────────── tapping

function onStagePointerDown(event) {
  if (state.currentScreen !== 'game' || !state.level) return;
  event.preventDefault();
  const img = $('photoImg');
  if (!img.naturalWidth) return;
  const rect = img.getBoundingClientRect();
  const nx = (event.clientX - rect.left) / rect.width;
  const ny = (event.clientY - rect.top) / rect.height;
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
  $('clearTitle').textContent = `${stats.title} · 十件全數尋獲`;
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
    const rule = scoring
      ? `<p class="board-rule">成績 = 每章最快一次（用時 + 誤點 × ${Math.round(
          scoring.wrongTapPenaltyMs / 1000,
        )} 秒）加總，數字越小越好；同分先比誤點，再比用時。</p>`
      : '';
    if (!leaderboard.length) {
      $('boardBody').innerHTML = `${rule}<p class="modal-text">還沒有人破關，你可以是第一個。</p>`;
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
      await ensurePlayer(nickname);
      await refreshLevels();
      renderLevels();
      renderHomeStats();
      audio.playBgm('menu');
      showScreen('levels');
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

  $('photoStage').addEventListener('pointerdown', onStagePointerDown);
  $('photoStage').addEventListener('contextmenu', (event) => event.preventDefault());

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

  window.addEventListener('resize', () => {
    syncOverlay();
    renderMarkers();
  });
  window.addEventListener('orientationchange', () => window.setTimeout(() => {
    syncOverlay();
    renderMarkers();
  }, 250));
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(() => {
      syncOverlay();
      renderMarkers();
    });
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
