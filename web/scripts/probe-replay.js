/**
 * Focused probe: does replaying a cleared chapter double-count progress?
 *   node scripts/probe-replay.js
 */
const BASE = process.argv[2] || 'http://127.0.0.1:8080';

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const player = (await api('POST', '/players', { nickname: 'replay-probe' })).json.player;
const level = (await api('GET', '/levels/1')).json.level;

const clear = async () => {
  for (const object of level.objects) {
    await api('POST', `/players/${player.playerKey}/levels/1/found`, { objectId: object.id });
  }
};

console.log(`new player: hints=${player.hints} levelsCleared=${player.levelsCleared}`);
await api('POST', `/players/${player.playerKey}/levels/1/start`, {});
await clear();
let profile = (await api('GET', `/players/${player.playerKey}`)).json;
console.log(`after 1st clear: levelsCleared=${profile.player.levelsCleared} completed=${profile.progress[0].completed} hints=${profile.player.hints}`);

const restarted = (await api('POST', `/players/${player.playerKey}/levels/1/start`, { restart: true })).json;
console.log(`after restart  : foundCount=${restarted.progress.foundCount} completed=${restarted.progress.completed}`);

await clear();
profile = (await api('GET', `/players/${player.playerKey}`)).json;
console.log(`after 2nd clear: levelsCleared=${profile.player.levelsCleared} hints=${profile.player.hints} bestMs=${profile.progress[0].bestMs}`);
console.log(profile.player.levelsCleared === 1 ? 'OK: replay does not double count' : 'BUG: replay double counted');
process.exit(profile.player.levelsCleared === 1 ? 0 : 1);
