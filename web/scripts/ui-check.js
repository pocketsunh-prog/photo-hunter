/**
 * Real-browser UI test for the web app.
 *
 *   node scripts/ui-check.js                 (server must be running on :4000)
 *   node scripts/ui-check.js http://127.0.0.1:4000
 *
 * Drives the actual SPA in headless Chrome: starts a game, opens chapter 1,
 * taps the ten anachronisms using the same bboxes the API serves, spends a 錦囊
 * through the hint dialog, clears chapters 2-5 to prove the 5-chapter pouch
 * reward, reloads the page to prove MySQL persistence, and writes screenshots to
 * scripts/screenshots/ for eyeballing.
 *
 * Uses the locally installed Chrome via puppeteer-core (no bundled Chromium).
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] || process.env.PHOTO_HUNTER_API || 'http://127.0.0.1:4000';
const SHOTS = path.join(import.meta.dirname, 'screenshots');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

let checks = 0;
const failures = [];

function check(label, ok, detail = '') {
  checks += 1;
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${label}${ok || !detail ? '' : ` -> ${detail}`}`);
  if (!ok) failures.push(`${label}${detail ? ` -> ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await fs.promises.access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  throw new Error('no Chrome/Edge binary found');
}

/** Tap the photo at a normalised position, exactly like a finger would. */
async function tapPhoto(page, [nx, ny]) {
  await page.evaluate(
    (x, y) => {
      const rect = document.getElementById('photoImg').getBoundingClientRect();
      document.getElementById('photoStage').dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: rect.left + rect.width * x,
          clientY: rect.top + rect.height * y,
          bubbles: true,
        }),
      );
    },
    nx,
    ny,
  );
}

async function clearChapter(page, levelId) {
  const chapter = await (await fetch(`${BASE}/api/levels/${levelId}`)).json();
  for (const object of chapter.level.objects) {
    await tapPhoto(page, [object.bbox[0] + object.bbox[2] / 2, object.bbox[1] + object.bbox[3] / 2]);
    await sleep(170);
  }
  await page.waitForFunction(() => !document.getElementById('modalClear').hidden, { timeout: 25000 });
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const executablePath = await findChrome();
  console.log('photo-hunter UI check');
  console.log(`  browser: ${executablePath}`);
  console.log(`  target : ${BASE}\n`);

  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=430,900', '--mute-audio'],
    defaultViewport: { width: 430, height: 900, deviceScaleFactor: 2 },
  });

  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  try {
    // ── home ──────────────────────────────────────────────────────────────
    console.log('1. home screen');
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForSelector('#screen-home.is-active', { timeout: 15000 });
    check('home screen becomes active', true);
    const serverNote = await page.$eval('#homeServerNote', (el) => el.textContent.trim());
    check('home screen reports the MySQL contents', serverNote.includes('10 章') && serverNote.includes('100 件物品'), serverNote);

    await page.click('#nicknameInput');
    await page.type('#nicknameInput', '煙測捕快');
    await page.screenshot({ path: path.join(SHOTS, '01-home.png') });

    // ── level select ──────────────────────────────────────────────────────
    console.log('\n2. chapter select');
    await page.click('#btnStart');
    await page.waitForSelector('#screen-levels.is-active', { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll('.level-card').length === 10, { timeout: 15000 });
    check('ten chapter cards are rendered', true);
    // The thumbnails are lazy-loaded, so wait for the decode instead of sampling
    // immediately (this used to be a flaky check).
    await page
      .waitForFunction(
        () => {
          const images = [...document.querySelectorAll('.level-card img')];
          return images.length === 10 && images.every((img) => img.complete && img.naturalWidth > 0);
        },
        { timeout: 20000 },
      )
      .catch(() => {});
    const hintsChip = await page.$eval('#levelsHintsChip', (el) => el.textContent.trim());
    check('chapter select shows 3 starter 錦囊', hintsChip.includes('3'), hintsChip);
    const thumbsOk = await page.$$eval('.level-card img', (imgs) =>
      imgs.filter((img) => img.complete && img.naturalWidth > 0).length,
    );
    check('all chapter thumbnails load', thumbsOk === 10, `loaded=${thumbsOk}`);
    await page.screenshot({ path: path.join(SHOTS, '02-chapters.png') });

    // ── game ──────────────────────────────────────────────────────────────
    console.log('\n3. play chapter 1 by tapping the photo');
    await page.click('.level-card');
    await page.waitForSelector('#screen-game.is-active', { timeout: 15000 });
    await page.waitForFunction(
      () => {
        const img = document.getElementById('photoImg');
        return img && img.complete && img.naturalWidth > 0;
      },
      { timeout: 20000 },
    );
    check('photo loads and the game screen is active', true);

    const levelData = await (await fetch(`${BASE}/api/levels/1`)).json();
    const objects = levelData.level.objects;
    check('chapter 1 exposes 10 objects to the client', objects.length === 10, `count=${objects.length}`);

    const aligned = await page.evaluate(() => {
      const img = document.getElementById('photoImg').getBoundingClientRect();
      const layer = document.getElementById('markerLayer').getBoundingClientRect();
      return {
        dx: Math.abs(img.left - layer.left),
        dy: Math.abs(img.top - layer.top),
        dw: Math.abs(img.width - layer.width),
        dh: Math.abs(img.height - layer.height),
      };
    });
    check(
      'marker overlay is aligned with the drawn photo',
      aligned.dx < 1.5 && aligned.dy < 1.5 && aligned.dw < 1.5 && aligned.dh < 1.5,
      JSON.stringify(aligned),
    );

    await tapPhoto(page, [0.5, 0.008]); // top edge of the photo: no target lives there
    await sleep(500);
    const missFx = await page.evaluate(() => document.querySelectorAll('.tap-fx.miss').length);
    check('a wrong tap draws the miss effect', missFx >= 1, `fx=${missFx}`);

    const hintBefore = await page.$eval('#hintCount', (el) => Number(el.textContent));
    await page.click('#btnHint');
    await page.waitForFunction(() => !document.getElementById('modalHint').hidden, { timeout: 5000 });
    check('hint dialog opens', true);
    await page.screenshot({ path: path.join(SHOTS, '03-hint-dialog.png') });
    await page.click('[data-hint-mode="reveal"]');
    await page.waitForFunction(
      (before) => Number(document.getElementById('hintCount').textContent) === before - 1,
      { timeout: 8000 },
      hintBefore,
    );
    check('using a 錦囊 spends exactly one pouch', true);
    const afterReveal = await page.$eval('#foundCount', (el) => Number(el.textContent));
    check('the auto-find 錦囊 found one object', afterReveal === 1, `found=${afterReveal}`);

    await clearChapter(page, 1);
    check('all ten anachronisms register through real taps', true);
    check('chapter-clear dialog appears', true);
    await page.screenshot({ path: path.join(SHOTS, '04-chapter-clear.png') });

    const marks = await page.evaluate(() => document.querySelectorAll('#markerLayer .marker').length);
    check('ten markers are drawn on the photo', marks === 10, `markers=${marks}`);

    // ── re-open chapter 1: the locate hint should ring an object ───────────
    console.log('\n4. chapter replay + locate 錦囊');
    await page.click('#btnReplayLevel');
    await page.waitForFunction(
      () => document.getElementById('screen-game').classList.contains('is-active')
        && Number(document.getElementById('foundCount').textContent) === 0,
      { timeout: 20000 },
    );
    check('重玩本章 resets the photo to 0/10', true);
    await page.click('#btnHint');
    await page.waitForFunction(() => !document.getElementById('modalHint').hidden, { timeout: 5000 });
    await page.click('[data-hint-mode="locate"]');
    await page.waitForFunction(() => document.querySelectorAll('.hint-ring').length === 1, { timeout: 8000 });
    check('提示位置 draws a locate ring on the photo', true);
    const toastText = await page.evaluate(() => {
      const toasts = [...document.querySelectorAll('.toast')].map((t) => t.textContent);
      return toasts.join(' | ');
    });
    check('hint text is shown to the player', /錦囊指路/.test(toastText), toastText);
    await page.screenshot({ path: path.join(SHOTS, '05-locate-hint.png') });
    const ringGone = await page
      .waitForFunction(() => document.querySelectorAll('.hint-ring').length === 0, { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    check('locate ring clears itself after 5 seconds', ringGone);
    await clearChapter(page, 1);
    await page.click('#btnNextLevel');

    // ── 5-chapter milestone ───────────────────────────────────────────────
    console.log('\n5. clear chapters 2-5 and check the 錦囊 reward');
    for (const id of [2, 3, 4, 5]) {
      await page.waitForFunction(
        () => Number(document.getElementById('foundCount').textContent) === 0
          && document.getElementById('photoImg').complete,
        { timeout: 25000 },
      );
      await clearChapter(page, id);
      if (id !== 5) await page.click('#btnNextLevel');
    }
    const rewardText = await page.$eval('#clearReward', (el) => (el.hidden ? '' : el.textContent.trim()));
    check('5-chapter milestone shows the 錦囊 reward', /錦囊/.test(rewardText), rewardText || '(hidden)');
    check('reward grants 3 pouches', /3 個錦囊/.test(rewardText), rewardText || '(hidden)');
    check('pouch total after the milestone is reported', /目前錦囊 ×\d/.test(rewardText), rewardText || '(hidden)');
    await page.screenshot({ path: path.join(SHOTS, '06-milestone-reward.png') });

    // ── map + persistence ─────────────────────────────────────────────────
    console.log('\n6. map state, persistence and audio');
    await page.click('#btnClearToMap');
    await page.waitForSelector('#screen-levels.is-active', { timeout: 10000 });
    const clearedCards = await page.evaluate(() => document.querySelectorAll('.level-card.is-done').length);
    check('cleared chapters show the done badge on the map', clearedCards === 5, `done=${clearedCards}`);
    await page.screenshot({ path: path.join(SHOTS, '07-chapters-progress.png') });

    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('#screen-home.is-active', { timeout: 15000 });
    await sleep(1500);
    const homeChip = await page.$eval('#homeProgressChip', (el) => el.textContent.trim());
    check('progress survives a page reload (MySQL)', homeChip.includes('5'), homeChip);

    const hasAudioContext = await page.evaluate(() => typeof window.AudioContext === 'function');
    check('WebAudio is available for music and effects', hasAudioContext);

    const audioServed = await page.evaluate(async (base) => {
      const names = ['bgm-menu.wav', 'bgm-game.wav', 'sfx-found.wav', 'sfx-hint.wav', 'sfx-level-clear.wav', 'sfx-bonus.wav'];
      return Promise.all(
        names.map(async (name) => {
          const response = await fetch(`${base}/assets/audio/${name}`);
          const buffer = await response.arrayBuffer();
          return { name, ok: response.ok, bytes: buffer.byteLength };
        }),
      );
    }, BASE);
    check(
      'all six audio files are served and non-empty',
      audioServed.every((r) => r.ok && r.bytes > 10000),
      audioServed.map((r) => `${r.name}:${r.bytes}`).join(' '),
    );

    console.log('\n7. leaderboard shows the time + wrong-click ranking');
    await page.click('#btnLeaderboard');
    await page.waitForFunction(() => {
      const modal = document.getElementById('modalLeaderboard');
      return modal && !modal.hidden && document.querySelector('#boardBody table');
    }, { timeout: 15000 });
    const boardInfo = await page.evaluate(() => {
      const headers = [...document.querySelectorAll('#boardBody thead th')].map((th) => th.textContent.trim());
      const rule = document.querySelector('#boardBody .board-rule')?.textContent.trim() ?? '';
      const firstRow = [...document.querySelectorAll('#boardBody tbody tr:first-child td')].map((td) => td.textContent.trim());
      return { headers, rule, firstRow };
    });
    check('leaderboard has a 成績 column', boardInfo.headers.includes('成績'), boardInfo.headers.join('/'));
    check('leaderboard shows 誤點 and 總用時', boardInfo.headers.includes('誤點') && boardInfo.headers.includes('總用時'), boardInfo.headers.join('/'));
    check('leaderboard explains the wrong-click penalty', /誤點/.test(boardInfo.rule) && /3 秒/.test(boardInfo.rule), boardInfo.rule);
    check('the top row carries rank, name and a score', boardInfo.firstRow.length >= 5 && /\d/.test(boardInfo.firstRow[0]), boardInfo.firstRow.join(' | '));
    await page.screenshot({ path: path.join(SHOTS, '08-leaderboard.png') });
    await page.evaluate(() => document.querySelector('#modalLeaderboard [data-close-modal]').click());

    console.log('\n8. console hygiene');
    check('no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    const realErrors = consoleErrors.filter((text) => !/favicon|autoplay|AudioContext|not allowed to start/i.test(text));
    check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

    console.log(`\n${checks - failures.length}/${checks} checks passed`);
    if (failures.length) {
      console.log('\nfailures:');
      for (const failure of failures) console.log(`  - ${failure}`);
    } else {
      console.log(`screenshots written to ${path.relative(process.cwd(), SHOTS)}`);
    }
    process.exitCode = failures.length ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('\nUI check crashed:', error);
  process.exit(1);
});
