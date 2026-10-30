'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameServer } = require('../server');

async function withServer(fn) {
  const game = createGameServer();
  await new Promise((resolve) => game.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${game.server.address().port}`;
  try { await fn(base, game); }
  finally { await game.shutdown(); }
}

async function post(base, route, payload) {
  const response = await fetch(`${base}/api/${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return { status: response.status, data: await response.json() };
}

async function openStream(base, code, token) {
  const controller = new AbortController();
  const response = await fetch(`${base}/api/events?code=${code}&token=${token}`, { signal: controller.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  return { controller, reader: response.body.getReader(), buffered: '' };
}

async function readState(stream) {
  const decoder = new TextDecoder();
  for (let i = 0; i < 10; i++) {
    const separator = stream.buffered.indexOf('\n\n');
    if (separator >= 0) {
      const frame = stream.buffered.slice(0, separator);
      stream.buffered = stream.buffered.slice(separator + 2);
      if (frame.startsWith('event: state\n')) {
        const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
        return JSON.parse(dataLine.slice(6));
      }
      continue;
    }
    const { value, done } = await stream.reader.read();
    if (done) throw new Error('SSE stream ended unexpectedly');
    stream.buffered += decoder.decode(value, { stream: true });
  }
  throw new Error('Expected a game state SSE event');
}

test('health page and UI assets load without npm dependencies', async () => {
  await withServer(async (base) => {
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.activeRooms, 0);
    const page = await (await fetch(base)).text();
    assert.match(page, /Good games/);
    const js = await fetch(`${base}/app.js`);
    assert.equal(js.status, 200);
    const notFound = await fetch(`${base}/../missing`);
    assert.equal(notFound.status, 404);
  });
});

test('two devices join, see live state, enforce turns, win, rematch, and leave', async () => {
  await withServer(async (base, game) => {
    const created = await post(base, 'create', { name: 'Alex' });
    assert.equal(created.status, 201);
    const { code, token: firstToken } = created.data;
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
    const host = await openStream(base, code, firstToken);
    const firstState = await readState(host);
    assert.equal(firstState.phase, 'waiting');
    assert.equal(firstState.yourSeat, 1);

    const joined = await post(base, 'join', { code: code.toLowerCase(), name: 'Blair' });
    assert.equal(joined.status, 200);
    const secondToken = joined.data.token;
    const guest = await openStream(base, code, secondToken);
    const secondState = await readState(guest);
    assert.equal(secondState.phase, 'playing');
    assert.equal(secondState.yourSeat, 2);
    assert.equal(secondState.players[0].name, 'Alex');
    assert.equal(secondState.players[1].name, 'Blair');

    assert.equal((await post(base, 'join', { code, name: 'Spectator' })).status, 409);
    assert.equal((await post(base, 'join', { code, token: firstToken })).data.seat, 1);
    assert.equal((await post(base, 'move', { code, token: secondToken, column: 2 })).status, 409);
    assert.equal((await post(base, 'move', { code, token: firstToken, column: 7 })).status, 400);

    // Gold connects four vertically while Lavender fills column 2.
    const moves = [[firstToken,0],[secondToken,1],[firstToken,0],[secondToken,1],
      [firstToken,0],[secondToken,1],[firstToken,0]];
    for (const [token, column] of moves) {
      const reply = await post(base, 'move', { code, token, column });
      assert.equal(reply.status, 200, `Valid move rejected: ${JSON.stringify(reply.data)}`);
    }
    const room = game.rooms.get(code);
    assert.equal(room.phase, 'finished');
    assert.equal(room.winner, 1);
    assert.equal(room.winningCells.length, 4);
    assert.equal(room.scores[1], 1);
    assert.equal((await post(base, 'move', { code, token: secondToken, column: 3 })).status, 409);

    assert.equal((await post(base, 'rematch', { code, token: firstToken })).status, 200);
    assert.equal(room.phase, 'finished', 'rematch requires both players to accept');
    assert.equal((await post(base, 'rematch', { code, token: secondToken })).status, 200);
    assert.equal(room.phase, 'playing');
    assert.equal(room.round, 2);
    assert.equal(room.turn, 2, 'starting player alternates for fairness');
    assert.equal(room.scores[1], 1, 'scores persist between rounds');
    assert(room.board.every((row) => row.every((value) => value === 0)));

    assert.equal((await post(base, 'leave', { code, token: secondToken })).status, 200);
    assert.equal(room.phase, 'waiting');
    assert.equal(room.players[1], null);
    assert.equal(room.scores[1], 0, 'a new opponent starts a new match');
    const another = await post(base, 'join', { code, name: 'Casey' });
    assert.equal(another.status, 200);
    assert.equal(another.data.seat, 2);
    assert.notEqual(another.data.token, secondToken);

    guest.controller.abort();
    host.controller.abort();
  });
});

test('disconnect pauses a round, and returning with the same token resumes the seat', async () => {
  await withServer(async (base, game) => {
    const { data: p1 } = await post(base, 'create', { name: 'P1' });
    const first = await openStream(base, p1.code, p1.token);
    const { data: p2 } = await post(base, 'join', { code: p1.code, name: 'P2' });
    const second = await openStream(base, p1.code, p2.token);
    assert.equal(game.rooms.get(p1.code).phase, 'playing');
    second.controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(game.rooms.get(p1.code).phase, 'paused');
    const resume = await post(base, 'join', { code: p1.code, token: p2.token, name: 'P2' });
    assert.equal(resume.data.resumed, true);
    assert.equal(resume.data.seat, 2);
    const secondAgain = await openStream(base, p1.code, p2.token);
    assert.equal(game.rooms.get(p1.code).phase, 'playing');
    first.controller.abort();
    secondAgain.controller.abort();
  });
});

test('requests are bounded and no one can move without a valid room token', async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, 'move', { code: 'ZZZZZZ', token: 'bad', column: 0 })).status, 401);
    assert.equal((await post(base, 'join', { code: '123', name: 'Bob' })).status, 400);
    assert.equal((await post(base, 'create', { name: '<>\u0000' })).status, 400);
    const huge = await fetch(`${base}/api/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'X'.repeat(5000) }),
    });
    assert.equal(huge.status, 413);
  });
});

test('a fully expired room cannot be joined after cleanup', async () => {
  await withServer(async (base, game) => {
    const created = await post(base, 'create', { name: 'Absent' });
    const { code } = created.data;
    game.rooms.get(code).players[0].offlineSince = Date.now() - 121000;
    const joined = await post(base, 'join', { code, name: 'New' });
    assert.equal(joined.status, 404);
    assert.equal(game.rooms.has(code), false);
  });
});
