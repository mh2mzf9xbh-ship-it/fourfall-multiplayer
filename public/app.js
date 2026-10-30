'use strict';

// Browser-only logic. The server authoritatively validates all moves.
const $ = (id) => document.getElementById(id);
const elements = {
  lobby: $('lobbyScreen'), game: $('gameScreen'), name: $('playerName'), codeInput: $('roomCodeInput'),
  create: $('createButton'), join: $('joinButton'), error: $('lobbyError'),
  connBadge: $('connectionBadge'), connText: $('connectionText'),
  notice: $('gameNotice'), noticeTitle: $('noticeTitle'), noticeDetail: $('noticeDetail'),
  codeLabel: $('roomCodeLabel'), drop: $('dropButtons'), board: $('board'), round: $('roundLabel'),
  oneName: $('playerOneName'), twoName: $('playerTwoName'), oneStatus: $('playerOneStatus'),
  twoStatus: $('playerTwoStatus'), oneScore: $('scoreOne'), twoScore: $('scoreTwo'), drawScore: $('scoreDraws'),
  rematchActions: $('roundActions'), rematch: $('rematchButton'), rematchMessage: $('rematchMessage'),
  copy: $('copyInviteButton'), leave: $('leaveButton'), toast: $('toast'),
};

let activeSession = null; // {code, token, seat, name}; token never appears in share links
let stream = null;
let currentState = null;
let streamConnected = false;
let busy = false;
let toastTimer = null;

function setConnection(value, label) {
  elements.connBadge.className = `connection-badge ${value}`;
  elements.connText.textContent = label;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 3300);
}

function setBusy(on) {
  busy = on;
  elements.create.disabled = on;
  elements.join.disabled = on;
}

function saveName(name) {
  try { localStorage.setItem('fourfall-name', name); } catch (_) { /* optional */ }
}

function getSaved(code) {
  try { return JSON.parse(sessionStorage.getItem(`fourfall-${code}`) || 'null'); }
  catch (_) { return null; }
}

function saveSession(s) {
  try { sessionStorage.setItem(`fourfall-${s.code}`, JSON.stringify(s)); }
  catch (_) { /* private browsing may deny storage */ }
}

function forgetSession(s) {
  if (!s) return;
  try { sessionStorage.removeItem(`fourfall-${s.code}`); } catch (_) { /* ignore */ }
}

async function request(route, data) {
  let response;
  try {
    response = await fetch(`/api/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), cache: 'no-store',
    });
  } catch (_) {
    throw new Error('Cannot reach the game server. Check your internet connection.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function showLobby(error = '') {
  elements.game.hidden = true;
  elements.lobby.hidden = false;
  elements.error.textContent = error;
  currentState = null;
  if (stream) { stream.close(); stream = null; }
  streamConnected = false;
  activeSession = null;
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState({}, '', url.pathname + url.search);
  setConnection('online', 'Ready to play');
}

function startSession(s) {
  if (stream) stream.close();
  activeSession = s;
  saveSession(s);
  saveName(s.name);
  elements.codeInput.value = s.code;
  elements.codeLabel.textContent = s.code;
  elements.lobby.hidden = true;
  elements.game.hidden = false;
  const url = new URL(location.href);
  url.searchParams.set('room', s.code);
  history.replaceState({}, '', url.pathname + url.search);
  connectLiveStream();
}

function connectLiveStream() {
  if (!activeSession) return;
  if (stream) stream.close();
  streamConnected = false;
  setConnection('connecting', 'Reconnecting...');
  const { code, token } = activeSession;
  const incoming = new EventSource(`/api/events?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
  stream = incoming;
  incoming.onopen = () => {
    if (incoming !== stream) return;
    streamConnected = true;
    setConnection('online', 'Live & connected');
    if (currentState) render(currentState);
  };
  incoming.addEventListener('state', (message) => {
    if (incoming !== stream) return;
    try { render(JSON.parse(message.data)); } catch (_) { /* ignore a malformed frame */ }
  });
  incoming.addEventListener('closed', () => {
    if (incoming !== stream) return;
    forgetSession(activeSession);
    showLobby('This room session has ended. You can create or join another room.');
  });
  incoming.onerror = () => {
    if (incoming !== stream) return;
    streamConnected = false;
    setConnection('offline', 'Trying to reconnect');
    if (currentState) render(currentState);
    // EventSource retries on its own. If this session expired, a later API
    // interaction reports it and the player can rejoin with a fresh seat.
  };
}

async function createRoom() {
  if (busy) return;
  const name = elements.name.value.trim();
  if (!name) { elements.error.textContent = 'Enter a display name to start.'; elements.name.focus(); return; }
  elements.error.textContent = '';
  setBusy(true);
  try {
    const response = await request('create', { name });
    startSession({ ...response, name });
  } catch (error) {
    elements.error.textContent = error.message;
  } finally { setBusy(false); }
}

async function joinRoom() {
  if (busy) return;
  const code = elements.codeInput.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const saved = getSaved(code);
  const name = elements.name.value.trim() || saved?.name || '';
  if (!name) { elements.error.textContent = 'Enter a display name to join.'; elements.name.focus(); return; }
  if (code.length !== 6) { elements.error.textContent = 'Enter the complete six-character room code.'; elements.codeInput.focus(); return; }
  elements.error.textContent = '';
  setBusy(true);
  try {
    let response;
    try {
      response = await request('join', { code, name, token: saved?.token || '' });
    } catch (error) {
      // A stale session can be replaced if its seat was released.
      if (!saved || !/Room session|room session/i.test(error.message)) throw error;
      forgetSession(saved);
      response = await request('join', { code, name });
    }
    startSession({ ...response, name: response.resumed && saved ? saved.name : name });
  } catch (error) {
    elements.error.textContent = error.message;
  } finally { setBusy(false); }
}

function render(state) {
  if (!activeSession) return;
  currentState = state;
  const { players, board, scores } = state;
  elements.round.textContent = `ROUND ${String(state.round).padStart(2, '0')}`;
  elements.oneName.textContent = players[0]?.name || 'Waiting...';
  elements.twoName.textContent = players[1]?.name || 'Waiting...';
  elements.oneStatus.textContent = `Player 1 · Gold${state.yourSeat === 1 ? ' · YOU' : ''}${players[0] ? players[0].online ? ' · online' : ' · offline' : ''}`;
  elements.twoStatus.textContent = `Player 2 · Lavender${state.yourSeat === 2 ? ' · YOU' : ''}${players[1] ? players[1].online ? ' · online' : ' · offline' : ''}`;
  elements.oneScore.textContent = scores[1];
  elements.twoScore.textContent = scores[2];
  elements.drawScore.textContent = scores.draws;

  const myTurn = streamConnected && state.phase === 'playing' && state.yourSeat === state.turn;
  elements.board.replaceChildren();
  elements.drop.replaceChildren();
  const winners = new Set(state.winningCells.map((c) => `${c.row}-${c.column}`));

  for (let col = 0; col < 7; col++) {
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'drop-button';
    drop.textContent = '↓';
    drop.setAttribute('aria-label', `Drop in column ${col + 1}`);
    drop.title = `Drop in column ${col + 1}`;
    drop.disabled = !myTurn || board[0][col] !== 0;
    drop.addEventListener('click', () => makeMove(col));
    elements.drop.append(drop);
  }
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.createElement('button');
      const occupant = board[row][col];
      cell.type = 'button';
      cell.className = `board-cell${occupant === 1 ? ' gold' : occupant === 2 ? ' purple' : ''}${winners.has(`${row}-${col}`) ? ' winning' : ''}${state.lastMove?.row === row && state.lastMove?.column === col ? ' last' : ''}${myTurn && board[0][col] === 0 ? ' playable' : ''}`;
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `Row ${row + 1}, column ${col + 1}: ${occupant === 1 ? 'Gold' : occupant === 2 ? 'Lavender' : 'empty'}`);
      cell.disabled = !myTurn || board[0][col] !== 0;
      const token = document.createElement('span');
      token.className = 'token';
      cell.append(token);
      cell.addEventListener('click', () => makeMove(col));
      elements.board.append(cell);
    }
  }

  elements.notice.className = 'game-notice';
  const opponent = players[state.yourSeat === 1 ? 1 : 0];
  if (!streamConnected) {
    elements.noticeTitle.textContent = 'Connection interrupted';
    elements.noticeDetail.textContent = 'Your browser is reconnecting automatically.';
  } else if (state.phase === 'waiting') {
    elements.noticeTitle.textContent = 'Waiting for player two';
    elements.noticeDetail.textContent = `Share code ${state.code} or the invite link with a friend.`;
  } else if (state.phase === 'paused') {
    elements.noticeTitle.textContent = 'Game paused';
    elements.noticeDetail.textContent = 'Your opponent is offline. Their seat is held for up to two minutes.';
  } else if (state.phase === 'finished') {
    elements.notice.classList.add('finished');
    elements.noticeTitle.textContent = state.winner === 0 ? "It's a draw!" : state.winner === state.yourSeat ? 'You won! ✦' : `${players[state.winner - 1]?.name || 'Opponent'} wins!`;
    elements.noticeDetail.textContent = 'Both players can choose Play again for a rematch.';
  } else if (myTurn) {
    elements.notice.classList.add('your-turn');
    elements.noticeTitle.textContent = 'Your move!';
    elements.noticeDetail.textContent = `You are ${state.yourSeat === 1 ? 'Gold' : 'Lavender'}. Choose a column to drop your disc.`;
  } else {
    elements.noticeTitle.textContent = `${opponent?.name || 'Opponent'} is thinking...`;
    elements.noticeDetail.textContent = `It's ${state.turn === 1 ? 'Gold' : 'Lavender'}'s turn.`;
  }

  elements.rematchActions.hidden = state.phase !== 'finished';
  const voted = state.rematchVotes.includes(state.yourSeat);
  elements.rematch.disabled = voted || !streamConnected || !players.every((p) => p?.online);
  elements.rematch.textContent = voted ? 'Rematch requested ✓' : 'Play again ↻';
  elements.rematchMessage.textContent = voted ? 'Waiting for your opponent to accept.' : 'Both players must agree to play again.';
}

async function makeMove(column) {
  if (!activeSession || !currentState || !streamConnected || currentState.phase !== 'playing' || currentState.turn !== currentState.yourSeat) return;
  try { await request('move', { code: activeSession.code, token: activeSession.token, column }); }
  catch (error) { showToast(error.message); }
}

async function rematch() {
  if (!activeSession) return;
  try { await request('rematch', { code: activeSession.code, token: activeSession.token }); }
  catch (error) { showToast(error.message); }
}

async function copyInvite() {
  if (!activeSession) return;
  const invite = new URL(location.origin);
  invite.searchParams.set('room', activeSession.code);
  try {
    await navigator.clipboard.writeText(invite.href);
    showToast('Invite link copied! Send it to your friend.');
  } catch (_) {
    // Selectable prompt is a fallback for browsers that block Clipboard API.
    window.prompt('Copy your invite link:', invite.href);
  }
}

async function leave() {
  if (!activeSession) return;
  const leaving = activeSession;
  if (stream) { stream.close(); stream = null; }
  forgetSession(leaving);
  showLobby();
  try { await request('leave', { code: leaving.code, token: leaving.token }); }
  catch (_) { showToast('Connection lost; the empty seat will be released automatically.'); }
}

function init() {
  const url = new URL(location.href);
  const code = (url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  elements.codeInput.value = code;
  try { elements.name.value = localStorage.getItem('fourfall-name') || ''; } catch (_) { /* ignore */ }
  elements.create.addEventListener('click', createRoom);
  elements.join.addEventListener('click', joinRoom);
  elements.copy.addEventListener('click', copyInvite);
  elements.leave.addEventListener('click', leave);
  elements.rematch.addEventListener('click', rematch);
  elements.codeInput.addEventListener('input', () => {
    elements.codeInput.value = elements.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
  elements.codeInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') joinRoom(); });
  elements.name.addEventListener('keydown', (event) => { if (event.key === 'Enter') elements.codeInput.value.length === 6 ? joinRoom() : createRoom(); });
  document.addEventListener('keydown', (event) => {
    if (elements.game.hidden || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (/^[1-7]$/.test(event.key)) makeMove(Number(event.key) - 1);
  });
  setConnection('online', 'Ready to play');
  if (code) {
    const saved = getSaved(code);
    if (saved?.token) {
      // Refreshing this tab reclaims the seat automatically if still reserved.
      request('join', { code, token: saved.token, name: saved.name })
        .then((result) => startSession({ ...result, name: saved.name }))
        .catch(() => {
          forgetSession(saved);
          elements.error.textContent = 'Your previous seat expired. Enter your name to join again.';
        });
    } else {
      elements.error.textContent = 'Invite received! Enter your name, then select Join room.';
    }
  }
}

init();
