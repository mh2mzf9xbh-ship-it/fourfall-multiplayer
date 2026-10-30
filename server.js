'use strict';

/**
 * Fourfall: real-time two-player Connect Four with zero npm dependencies.
 * Server-Sent Events push state changes, and POST endpoints accept moves.
 * All game rules are validated on the server; room state is held in memory.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { emptyBoard, dropDisc, outcome } = require('./game');

const PUBLIC = path.join(__dirname, 'public');
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECONNECT_MS = 2 * 60 * 1000;
const ROOM_LIMIT = 300;
const PLAYER_LIMIT = 18;

function createGameServer() {
  const rooms = new Map();

  function sendJson(res, status, value) {
    if (res.writableEnded) return;
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(value));
  }

  function safeName(raw) {
    if (typeof raw !== 'string') return '';
    return raw.replace(/[\u0000-\u001F\u007F<>]/g, '').trim().slice(0, PLAYER_LIMIT);
  }

  function newCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const bytes = crypto.randomBytes(6);
      const code = Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
      if (!rooms.has(code)) return code;
    }
    throw new Error('Unable to create a room. Try again.');
  }

  function newToken() {
    return crypto.randomBytes(24).toString('hex');
  }

  function playerOnline(player) {
    return Boolean(player && player.connections.size > 0);
  }

  function bothOnline(room) {
    return room.players.every(playerOnline);
  }

  function snapshot(room, seat) {
    return {
      code: room.code,
      yourSeat: seat,
      phase: room.phase,
      round: room.round,
      turn: room.turn,
      winner: room.winner,
      winningCells: room.winningCells,
      lastMove: room.lastMove,
      board: room.board,
      scores: room.scores,
      rematchVotes: Array.from(room.rematchVotes),
      reconnectSeconds: Math.ceil(RECONNECT_MS / 1000),
      players: room.players.map((p, i) => p ? {
        seat: i + 1,
        name: p.name,
        online: playerOnline(p),
      } : null),
    };
  }

  function streamEvent(res, event, payload) {
    if (res.writableEnded || res.destroyed) return;
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`); }
    catch (_) { /* A closed connection will be removed by its close handler. */ }
  }

  function publish(room) {
    room.updatedAt = Date.now();
    room.players.forEach((p, index) => {
      if (!p) return;
      for (const res of p.connections) streamEvent(res, 'state', snapshot(room, index + 1));
    });
  }

  function resetRound(room, resetScores = false) {
    room.board = emptyBoard();
    room.turn = room.starter;
    room.winner = null;
    room.winningCells = [];
    room.lastMove = null;
    room.rematchVotes.clear();
    if (resetScores) {
      room.scores = { 1: 0, 2: 0, draws: 0 };
      room.round = 1;
      room.starter = 1;
      room.turn = 1;
    }
    room.phase = bothOnline(room) ? 'playing' : 'waiting';
  }

  function removePlayer(room, index) {
    const player = room.players[index];
    if (!player) return;
    for (const res of player.connections) {
      streamEvent(res, 'closed', { reason: 'You left this room.' });
      res.end();
    }
    player.connections.clear();
    room.players[index] = null;
    resetRound(room, true); // a replacement opponent starts a new match
    if (room.players.every((p) => !p)) {
      rooms.delete(room.code);
    } else {
      publish(room);
    }
  }

  function expireDisconnected(room) {
    for (let i = 0; i < 2; i++) {
      const p = room.players[i];
      if (p && !playerOnline(p) && p.offlineSince !== null && Date.now() - p.offlineSince > RECONNECT_MS) {
        removePlayer(room, i);
      }
    }
  }

  function authorize(code, token) {
    if (typeof code !== 'string' || typeof token !== 'string') return null;
    const room = rooms.get(code.trim().toUpperCase());
    if (!room) return null;
    expireDisconnected(room);
    const index = room.players.findIndex((p) => p && p.token === token);
    if (index === -1) return null;
    return { room, player: room.players[index], seat: index + 1 };
  }

  function updatePhase(room) {
    if (room.phase === 'finished') return;
    if (bothOnline(room)) room.phase = 'playing';
    else if (room.players.every((p) => p !== null)) room.phase = 'paused';
    else room.phase = 'waiting';
  }

  async function bodyJson(req) {
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 4096) {
        const error = new Error('Request too large.');
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch (_) {
      const error = new Error('Invalid JSON request.');
      error.status = 400;
      throw error;
    }
  }

  function createRoom(res, body) {
    const name = safeName(body.name);
    if (!name) return sendJson(res, 400, { error: 'Enter your name first.' });
    if (rooms.size >= ROOM_LIMIT) return sendJson(res, 503, { error: 'All game rooms are busy. Try again later.' });
    const code = newCode();
    const token = newToken();
    const room = {
      code,
      board: emptyBoard(),
      phase: 'waiting',
      players: [{ name, token, connections: new Set(), offlineSince: Date.now() }, null],
      turn: 1,
      starter: 1,
      round: 1,
      winner: null,
      winningCells: [],
      lastMove: null,
      scores: { 1: 0, 2: 0, draws: 0 },
      rematchVotes: new Set(),
      updatedAt: Date.now(),
    };
    rooms.set(code, room);
    return sendJson(res, 201, { code, token, seat: 1 });
  }

  function joinRoom(res, body) {
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) return sendJson(res, 400, { error: 'Enter a valid six-character room code.' });
    const room = rooms.get(code);
    if (!room) return sendJson(res, 404, { error: 'Room not found. Check the code, or ask for a new invite.' });
    expireDisconnected(room);
    if (!rooms.has(code)) return sendJson(res, 404, { error: 'This room expired. Ask for a new invite.' });
    const resumeToken = typeof body.token === 'string' ? body.token : '';
    const previousSeat = room.players.findIndex((p) => p && p.token === resumeToken && resumeToken.length > 0);
    if (previousSeat >= 0) {
      return sendJson(res, 200, { code, token: resumeToken, seat: previousSeat + 1, resumed: true });
    }
    const name = safeName(body.name);
    if (!name) return sendJson(res, 400, { error: 'Enter your name to join.' });
    const emptySeat = room.players.findIndex((p) => p === null);
    if (emptySeat < 0) return sendJson(res, 409, { error: 'This room already has two players.' });
    const token = newToken();
    room.players[emptySeat] = { name, token, connections: new Set(), offlineSince: Date.now() };
    resetRound(room, true);
    publish(room);
    return sendJson(res, 200, { code, token, seat: emptySeat + 1, resumed: false });
  }

  function connectEvents(req, res, url) {
    const session = authorize(url.searchParams.get('code'), url.searchParams.get('token'));
    if (!session) return sendJson(res, 401, { error: 'Room session expired. Join again.' });
    const { room, player, seat } = session;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    res.write(': connected\n\n');
    player.connections.add(res);
    player.offlineSince = null;
    updatePhase(room);
    publish(room);
    streamEvent(res, 'state', snapshot(room, seat));
    const heartbeat = setInterval(() => {
      if (!res.writableEnded && !res.destroyed) {
        try { res.write(': keep-alive\n\n'); } catch (_) { /* handled on close */ }
      }
    }, 20000);
    heartbeat.unref();
    res.on('close', () => {
      clearInterval(heartbeat);
      player.connections.delete(res);
      // Verify that this exact player still owns its seat.
      if (room.players[seat - 1] === player && !playerOnline(player)) {
        player.offlineSince = Date.now();
        updatePhase(room);
        publish(room);
      }
    });
  }

  function move(res, body) {
    const session = authorize(body.code, body.token);
    if (!session) return sendJson(res, 401, { error: 'Session expired. Join the room again.' });
    const { room, seat } = session;
    if (room.phase !== 'playing' || !bothOnline(room)) return sendJson(res, 409, { error: 'Both players must be connected before playing.' });
    if (room.turn !== seat) return sendJson(res, 409, { error: 'Wait for your turn.' });
    let pos;
    try { pos = dropDisc(room.board, body.column, seat); }
    catch (error) { return sendJson(res, 400, { error: error.message }); }
    room.lastMove = pos;
    const result = outcome(room.board, pos.row, pos.column);
    if (result.type === 'won') {
      room.phase = 'finished';
      room.winner = seat;
      room.winningCells = result.winningCells;
      room.scores[seat]++;
    } else if (result.type === 'draw') {
      room.phase = 'finished';
      room.winner = 0;
      room.scores.draws++;
    } else {
      room.turn = seat === 1 ? 2 : 1;
    }
    publish(room);
    return sendJson(res, 200, { ok: true });
  }

  function requestRematch(res, body) {
    const session = authorize(body.code, body.token);
    if (!session) return sendJson(res, 401, { error: 'Session expired. Join the room again.' });
    const { room, seat } = session;
    if (room.phase !== 'finished') return sendJson(res, 409, { error: 'Finish this round before requesting a rematch.' });
    if (!bothOnline(room)) return sendJson(res, 409, { error: 'Wait for your opponent to reconnect.' });
    room.rematchVotes.add(seat);
    if (room.rematchVotes.size === 2) {
      room.round++;
      room.starter = room.starter === 1 ? 2 : 1;
      resetRound(room);
    }
    publish(room);
    return sendJson(res, 200, { ok: true });
  }

  function leaveRoom(res, body) {
    const session = authorize(body.code, body.token);
    if (!session) return sendJson(res, 200, { ok: true });
    removePlayer(session.room, session.seat - 1);
    return sendJson(res, 200, { ok: true });
  }

  const staticFiles = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  };

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        return sendJson(res, 200, { ok: true, game: 'Fourfall', activeRooms: rooms.size });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') return connectEvents(req, res, url);
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const body = await bodyJson(req);
        if (url.pathname === '/api/create') return createRoom(res, body);
        if (url.pathname === '/api/join') return joinRoom(res, body);
        if (url.pathname === '/api/move') return move(res, body);
        if (url.pathname === '/api/rematch') return requestRematch(res, body);
        if (url.pathname === '/api/leave') return leaveRoom(res, body);
        return sendJson(res, 404, { error: 'API endpoint not found.' });
      }
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const [filename, mime] = staticFiles[url.pathname];
        const content = fs.readFileSync(path.join(PUBLIC, filename));
        res.writeHead(200, {
          'Content-Type': mime,
          'Cache-Control': 'public, max-age=60',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
        });
        return res.end(content);
      }
      return sendJson(res, 404, { error: 'Page not found.' });
    } catch (error) {
      console.error('Request failed:', error.message);
      return sendJson(res, error.status || 500, { error: error.status ? error.message : 'Server error. Please try again.' });
    }
  });

  const cleanup = setInterval(() => {
    for (const room of rooms.values()) expireDisconnected(room);
  }, 10000);
  cleanup.unref();

  function shutdown() {
    clearInterval(cleanup);
    for (const room of rooms.values()) {
      for (const player of room.players) {
        if (player) for (const res of player.connections) res.end();
      }
    }
    return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  return { server, rooms, shutdown };
}

if (require.main === module) {
  const { server } = createGameServer();
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1-65535.');
  server.listen(port, '0.0.0.0', () => {
    console.log(`Fourfall is ready: http://localhost:${port}`);
    console.log('Ctrl+C stops the game server.');
  });
}

module.exports = { createGameServer };
