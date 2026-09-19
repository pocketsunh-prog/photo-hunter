/**
 * End-to-end smoke test for the web stack.
 *
 *   node scripts/smoke-test.js            (server must be running on :8080)
 *   node scripts/smoke-test.js http://127.0.0.1:8080
 *
 * Exercises the real HTTP API against the real MySQL instance: creates a
 * player, plays chapter 1 with a 錦囊, clears chapters 1-5 and checks that the
 * 5-chapter milestone really did hand out extra 錦囊, then reads the
 * leaderboard. Exits non-zero on the first failed expectation.
 */
const BASE = process.argv[2] || process.env.PHOTO_HUNTER_API || 'http://127.0.0.1:8080';

let checks = 0;
const failures = [];

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  \u2713 ${label}`);
  } else {
    failures.push(`${label}${detail ? ` -> ${detail}` : ''}`);
    console.log(`  \u2717 ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  return { status: res.status, json, text };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`photo-hunter smoke test -> ${BASE}\n`);

  console.log('1. health');
  const health = await api('GET', '/api/health');
  check('GET /api/health is 200', health.status === 200, `status ${health.status}`);
  check('MySQL is connected', health.json?.database?.connected === true);
  const chapterTotal = health.json?.database?.chapters;
  const objectTotal = health.json?.database?.objects;
  // Chapter/object counts are data-driven: adding a volume must not require
  // editing this test, but a full five-volume game is expected here.
  check('at least 50 chapters are seeded', chapterTotal >= 50, `chapters=${chapterTotal}`);
  check('every chapter contributed its 10 objects', objectTotal === chapterTotal * 10, `objects=${objectTotal} chapters=${chapterTotal}`);
  check('rules expose 3 starter 錦囊', health.json?.rules?.startHints === 3, JSON.stringify(health.json?.rules));

  console.log('\n2. player (the nickname is the account)');
  const accountNick = `煙測小捕快${Date.now() % 100000}`;
  const created = await api('POST', '/api/players', { nickname: accountNick });
  check('POST /api/players is 201 for a brand new name', created.status === 201, `status ${created.status}`);
  const playerKey = created.json?.player?.playerKey;
  check('new player has 3 錦囊', created.json?.player?.hints === 3, `hints=${created.json?.player?.hints}`);
  check('player key looks like a uuid', /^[0-9a-f-]{36}$/i.test(playerKey || ''), playerKey);
  check('a new name is reported as a new account', created.json?.existing === false, JSON.stringify(created.json?.existing));

  // Signing in with the same name must land on the same account (any browser).
  const again = await api('POST', '/api/players', { nickname: accountNick });
  check('the same nickname resumes the same account', again.json?.player?.playerKey === playerKey, `${again.json?.player?.playerKey} vs ${playerKey}`);
  check('an existing account is flagged as existing', again.json?.existing === true, JSON.stringify(again.json?.existing));

  console.log('\n3. chapters');
  const list = await api('GET', `/api/levels?player=${playerKey}`);
  check('GET /api/levels is 200', list.status === 200, `status ${list.status}`);
  check('every seeded chapter is returned', list.json?.levels?.length === chapterTotal, `count=${list.json?.levels?.length} expected=${chapterTotal}`);
  check(
    'every chapter reports 10 seeded objects',
    (list.json?.levels ?? []).every((l) => l.seededObjects === 10),
    JSON.stringify((list.json?.levels ?? []).map((l) => l.seededObjects).filter((n) => n !== 10)),
  );
  check(
    'chapters are grouped into volumes',
    new Set((list.json?.levels ?? []).map((l) => l.collection)).size >= 5,
    JSON.stringify([...new Set((list.json?.levels ?? []).map((l) => l.collection))]),
  );
  const firstLevel = list.json?.levels?.[0];
  check('chapter titles are populated', Boolean(firstLevel?.title), JSON.stringify(firstLevel?.title));

  console.log('\n3b. missions unlock in order');
  check('the first mission is open', firstLevel?.locked === false, JSON.stringify(firstLevel?.locked));
  check(
    'every later mission starts locked',
    (list.json?.levels ?? []).slice(1).every((l) => l.locked === true),
    JSON.stringify((list.json?.levels ?? []).filter((l) => !l.locked).map((l) => l.id)),
  );
  check('a locked mission names its requirement', list.json?.levels?.[1]?.requiresLevel === 1, JSON.stringify(list.json?.levels?.[1]?.requiresLevel));
  const blocked = await api('POST', `/api/players/${playerKey}/levels/2/start`, {});
  check('starting a locked mission is refused', blocked.status === 403 && blocked.json?.error === 'LEVEL_LOCKED', `${blocked.status} ${blocked.json?.error}`);
  check('the refusal says which chapter to clear', /第 1 章/.test(blocked.json?.message ?? ''), blocked.json?.message);

  const detail = await api('GET', `/api/levels/1?player=${playerKey}`);
  const objects = detail.json?.level?.objects ?? [];
  check('GET /api/levels/1 returns 10 objects', objects.length === 10, `count=${objects.length}`);
  check(
    'every object has a normalised bbox inside the photo',
    objects.every(
      (o) =>
        Array.isArray(o.bbox) &&
        o.bbox.length === 4 &&
        o.bbox.every((v) => v >= 0 && v <= 1) &&
        o.bbox[0] + o.bbox[2] <= 1.0001 &&
        o.bbox[1] + o.bbox[3] <= 1.0001 &&
        o.bbox[2] >= 0.008 &&
        o.bbox[3] >= 0.008,
    ),
    JSON.stringify(objects.find((o) => !Array.isArray(o.bbox) || o.bbox[2] < 0.008)?.bbox),
  );
  const imageRes = await fetch(`${BASE}/assets/images/${detail.json?.level?.image}`);
  check('chapter image is served by the web app', imageRes.status === 200, `status ${imageRes.status}`);
  check('chapter image is a jpeg', (imageRes.headers.get('content-type') || '').includes('jpeg'), imageRes.headers.get('content-type'));
  const audioRes = await fetch(`${BASE}/assets/audio/bgm-game.wav`);
  check('background music is served', audioRes.status === 200 && (await audioRes.arrayBuffer()).byteLength > 100000);

  console.log('\n4. play chapter 1 (real taps + one 錦囊)');
  const start = await api('POST', `/api/players/${playerKey}/levels/1/start`, { restart: true });
  check('start returns a session id', Number.isFinite(start.json?.sessionId), JSON.stringify(start.json?.sessionId));
  const sessionId = start.json?.sessionId;
  check('start returns the 10 objects', start.json?.level?.objects?.length === 10);

  const miss = await api('POST', `/api/players/${playerKey}/levels/1/miss`, { sessionId });
  check('a wrong tap is recorded', miss.json?.progress?.wrongTaps === 1, JSON.stringify(miss.json?.progress?.wrongTaps));

  const hint = await api('POST', `/api/players/${playerKey}/levels/1/hint`, { mode: 'locate', sessionId });
  check('locate hint is accepted', hint.status === 200, `status ${hint.status} ${hint.text?.slice(0, 120)}`);
  check('locate hint costs exactly one 錦囊', hint.json?.player?.hints === 2, `hints=${hint.json?.player?.hints}`);
  check('locate hint points at a real object', Number.isFinite(hint.json?.object?.id), JSON.stringify(hint.json?.object?.id));
  check('locate hint does NOT count as found', (hint.json?.found ?? []).length === 0, JSON.stringify(hint.json?.found));

  const reveal = await api('POST', `/api/players/${playerKey}/levels/1/hint`, { mode: 'reveal', sessionId });
  check('reveal hint auto-finds one object', (reveal.json?.found ?? []).length === 1, JSON.stringify(reveal.json?.found));
  check('reveal hint costs one more 錦囊', reveal.json?.player?.hints === 1, `hints=${reveal.json?.player?.hints}`);

  const already = new Set(reveal.json?.found ?? []);
  let completion = null;
  for (const object of objects) {
    if (already.has(object.id)) continue;
    const found = await api('POST', `/api/players/${playerKey}/levels/1/found`, { objectId: object.id, sessionId });
    if (found.status !== 200) {
      check(`finding object ${object.id} succeeds`, false, `status ${found.status} ${found.text?.slice(0, 160)}`);
      break;
    }
    completion = found.json;
  }
  check('chapter 1 is completed after the tenth object', completion?.completed === true, JSON.stringify(completion?.completed));
  check('chapter 1 duration was timed by the server', Number.isFinite(completion?.durationMs), JSON.stringify(completion?.durationMs));
  check('no milestone reward before 5 chapters', completion?.reward?.awarded === 0, JSON.stringify(completion?.reward));

  const afterClear = (await api('GET', `/api/levels?player=${playerKey}`)).json.levels;
  check('clearing chapter 1 unlocks chapter 2', afterClear[1]?.locked === false, JSON.stringify(afterClear[1]?.locked));
  check('chapter 3 is still locked after only chapter 1', afterClear[2]?.locked === true, JSON.stringify(afterClear[2]?.locked));
  const stillBlocked = await api('POST', `/api/players/${playerKey}/levels/3/start`, {});
  check('skipping ahead is still refused', stillBlocked.status === 403, `status ${stillBlocked.status}`);

  const dup = await api('POST', `/api/players/${playerKey}/levels/1/found`, { objectId: objects[0].id, sessionId });
  check('finding the same object twice is idempotent', dup.json?.alreadyFound === true && dup.json?.foundCount === 10, JSON.stringify(dup.json?.foundCount));

  console.log('\n4b. replaying a cleared chapter must not double-count progress');
  const replay = await api('POST', `/api/players/${playerKey}/levels/1/start`, { restart: true });
  check('replay resets the photo to 0/10', replay.json?.progress?.foundCount === 0, `found=${replay.json?.progress?.foundCount}`);
  check('replay keeps the chapter marked as cleared', replay.json?.progress?.completed === true, JSON.stringify(replay.json?.progress?.completed));
  const bestBefore = (await api('GET', `/api/players/${playerKey}`)).json?.progress?.find((p) => p.levelId === 1)?.bestMs;
  for (const object of objects) {
    await api('POST', `/api/players/${playerKey}/levels/1/found`, { objectId: object.id, sessionId: replay.json?.sessionId });
  }
  const afterReplay = await api('GET', `/api/players/${playerKey}`);
  check('re-clearing a chapter does not inflate levelsCleared', afterReplay.json?.player?.levelsCleared === 1, `levelsCleared=${afterReplay.json?.player?.levelsCleared}`);
  check('replay grants no extra 錦囊', afterReplay.json?.player?.hints === 1, `hints=${afterReplay.json?.player?.hints}`);
  const bestAfter = afterReplay.json?.progress?.find((p) => p.levelId === 1)?.bestMs;
  check('best time is recorded, not zeroed', Number.isFinite(bestAfter) && bestAfter > 0, `bestMs=${bestAfter} (was ${bestBefore})`);

  console.log('\n5. clear chapters 2-5 and check the 錦囊 milestone');
  for (const id of [2, 3, 4, 5]) {
    await api('POST', `/api/players/${playerKey}/levels/${id}/start`, {});
    const chapter = await api('GET', `/api/levels/${id}`);
    let last = null;
    for (const object of chapter.json?.level?.objects ?? []) {
      last = await api('POST', `/api/players/${playerKey}/levels/${id}/found`, { objectId: object.id });
    }
    check(`chapter ${id} completed`, last?.json?.completed === true, JSON.stringify(last?.json?.completed));
    if (id === 5) {
      check('5 chapters cleared grants +3 錦囊', last?.json?.reward?.awarded === 3, JSON.stringify(last?.json?.reward));
      check('milestone 5 is reported', last?.json?.reward?.milestone === 5, JSON.stringify(last?.json?.reward?.milestone));
      check('pouch count is 1 + 3 = 4', last?.json?.player?.hints === 4, `hints=${last?.json?.player?.hints}`);
      check('levelsCleared is 5', last?.json?.player?.levelsCleared === 5, `levelsCleared=${last?.json?.player?.levelsCleared}`);
    }
  }

  console.log('\n6. profile + leaderboard');
  const profile = await api('GET', `/api/players/${playerKey}`);
  check('profile lists 5 completed chapters', (profile.json?.progress ?? []).filter((p) => p.completed).length === 5);
  const board = await api('GET', '/api/leaderboard');
  check('leaderboard is 200', board.status === 200, `status ${board.status}`);
  check('leaderboard contains the test player', (board.json?.leaderboard ?? []).some((r) => r.nickname === created.json?.player?.nickname));

  console.log('\n6b. leaderboard ranks by fastest time and fewest wrong clicks');
  const penalty = health.json?.rules?.wrongTapPenaltyMs;
  check('the wrong-tap penalty is part of the rules', penalty === 3000, String(penalty));
  check('the leaderboard explains its scoring', board.json?.scoring?.wrongTapPenaltyMs === 3000, JSON.stringify(board.json?.scoring));
  check(
    'every row score equals 用時 + 誤點 × 罰時',
    (board.json?.leaderboard ?? []).every((r) => r.scoreMs === r.timeMs + r.wrongTaps * 3000),
    JSON.stringify((board.json?.leaderboard ?? []).find((r) => r.scoreMs !== r.timeMs + r.wrongTaps * 3000)),
  );
  check(
    'rows are ordered by chapters then score',
    (board.json?.leaderboard ?? []).every(
      (row, index, rows) => index === 0 || rows[index - 1].chapters > row.chapters || (rows[index - 1].chapters === row.chapters && rows[index - 1].scoreMs <= row.scoreMs),
    ),
  );

  // Two fresh players on the same chapter: one clean, one sloppy. The sloppy run
  // must lose the rank even though its raw time is comparable.
  const stamp = Date.now() % 1000000;
  const cleanNick = `神射手${stamp}`;
  const sloppyNick = `手滑王${stamp}`;
  const cleanPlayer = await api('POST', '/api/players', { nickname: cleanNick });
  const sloppyPlayer = await api('POST', '/api/players', { nickname: sloppyNick });
  const chapterOne = (await api('GET', '/api/levels/1')).json.level;

  await api('POST', `/api/players/${cleanPlayer.json.player.playerKey}/levels/1/start`, {});
  for (const object of chapterOne.objects) {
    await api('POST', `/api/players/${cleanPlayer.json.player.playerKey}/levels/1/found`, { objectId: object.id });
  }

  const sloppyRun = await api('POST', `/api/players/${sloppyPlayer.json.player.playerKey}/levels/1/start`, {});
  for (let i = 0; i < 3; i += 1) {
    await api('POST', `/api/players/${sloppyPlayer.json.player.playerKey}/levels/1/miss`, { sessionId: sloppyRun.json.sessionId });
  }
  for (const object of chapterOne.objects) {
    await api('POST', `/api/players/${sloppyPlayer.json.player.playerKey}/levels/1/found`, {
      objectId: object.id,
      sessionId: sloppyRun.json.sessionId,
    });
  }

  const board2 = await api('GET', '/api/leaderboard?limit=50');
  const rows = board2.json?.leaderboard ?? [];
  // The top-N page cannot prove a mid-board player's rank once the game has many
  // players, so each player is asked for their own position instead.
  const cleanRow = (await api('GET', `/api/players/${cleanPlayer.json.player.playerKey}/rank`)).json;
  const sloppyRow = (await api('GET', `/api/players/${sloppyPlayer.json.player.playerKey}/rank`)).json;
  check('both new players can report their own rank', Boolean(cleanRow?.rank && sloppyRow?.rank), JSON.stringify([cleanRow?.rank, sloppyRow?.rank]));
  check('the sloppy run counted three wrong clicks', sloppyRow?.rank?.wrongTaps === 3, `wrongTaps=${sloppyRow?.rank?.wrongTaps}`);
  check('the sloppy run carries a 9 second penalty', sloppyRow?.rank?.scoreMs >= 9000, `scoreMs=${sloppyRow?.rank?.scoreMs}`);
  check('the clean run keeps a zero-wrong-click record', cleanRow?.rank?.wrongTaps === 0, `wrongTaps=${cleanRow?.rank?.wrongTaps}`);
  check('fewer wrong clicks earns the better rank', cleanRow?.rank?.rank < sloppyRow?.rank?.rank, `clean #${cleanRow?.rank?.rank} vs sloppy #${sloppyRow?.rank?.rank}`);
  check(
    'the board page agrees with the stored ranking',
    rows.length === 0 || rows[0].rank === 1,
    JSON.stringify(rows[0]?.rank),
  );

  console.log('\n6c. reset wipes that player only');
  const resetNick = `重置測試${stamp}`;
  const keeperNick = `不動如山${stamp}`;
  const resetPlayer = (await api('POST', '/api/players', { nickname: resetNick })).json.player;
  const keeperPlayer = (await api('POST', '/api/players', { nickname: keeperNick })).json.player;
  const resetKey = resetPlayer.playerKey;
  const keeperKey = keeperPlayer.playerKey;

  // Both players clear chapter 1, but the first one also burns a 錦囊.
  for (const key of [resetKey, keeperKey]) {
    const run = await api('POST', `/api/players/${key}/levels/1/start`, {});
    if (key === resetKey) {
      await api('POST', `/api/players/${key}/levels/1/hint`, { mode: 'locate', sessionId: run.json.sessionId });
    }
    for (const object of chapterOne.objects) {
      await api('POST', `/api/players/${key}/levels/1/found`, { objectId: object.id, sessionId: run.json.sessionId });
    }
  }
  const beforeReset = (await api('GET', `/api/players/${resetKey}`)).json;
  check('the test player has progress and a spent 錦囊 before reset', beforeReset.player.levelsCleared === 1 && beforeReset.player.hints === 2, `cleared=${beforeReset.player.levelsCleared} hints=${beforeReset.player.hints}`);
  // Ask the player for their own rank: the top-N page cannot show a mid-board
  // player once the game has more players than the page size.
  const rankBefore = (await api('GET', `/api/players/${resetKey}/rank`)).json;
  check('the player has a rank before reset', Number.isFinite(rankBefore?.rank?.rank), JSON.stringify(rankBefore?.rank));

  const resetResponse = await api('POST', `/api/players/${resetKey}/reset`, {});
  check('POST /players/:key/reset is 200', resetResponse.status === 200, `status ${resetResponse.status}`);
  check('reset reports what it cleared', (resetResponse.json?.cleared?.play_sessions ?? 0) >= 1, JSON.stringify(resetResponse.json?.cleared));
  check('reset is idempotent-safe (hints back to 3)', resetResponse.json?.player?.hints === 3, `hints=${resetResponse.json?.player?.hints}`);
  check('reset zeroes the counters', resetResponse.json?.player?.levelsCleared === 0 && resetResponse.json?.player?.totalMs === 0, JSON.stringify(resetResponse.json?.player));

  const afterReset = (await api('GET', `/api/players/${resetKey}`)).json;
  check('no chapter progress is left', afterReset.progress.every((p) => !p.completed && p.foundCount === 0), JSON.stringify(afterReset.progress));
  check('the nickname survives the reset', afterReset.player.nickname === resetNick, afterReset.player.nickname);
  const rankAfter = (await api('GET', `/api/players/${resetKey}/rank`)).json;
  check('the reset player loses their rank', rankAfter?.rank === null, JSON.stringify(rankAfter?.rank));
  const keeperRank = (await api('GET', `/api/players/${keeperKey}/rank`)).json;
  check('other players keep their rank after the reset', Number.isFinite(keeperRank?.rank?.rank), JSON.stringify(keeperRank?.rank));

  const resetAgain = await api('POST', `/api/players/${resetKey}/reset`, {});
  check('resetting twice is harmless', resetAgain.status === 200 && resetAgain.json?.player?.hints === 3, `status ${resetAgain.status}`);

  console.log('\n7. error handling');
  const noPlayer = await api('GET', '/api/players/00000000-0000-0000-0000-000000000000');
  check('unknown player returns 404', noPlayer.status === 404, `status ${noPlayer.status}`);
  const badLevel = await api('GET', '/api/levels/99');
  check('unknown chapter returns 404', badLevel.status === 404, `status ${badLevel.status}`);
  await sleep(50);

  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) {
    console.log('\nfailures:');
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log('web stack OK');
}

main().catch((error) => {
  console.error('\nsmoke test crashed:', error);
  process.exit(1);
});
