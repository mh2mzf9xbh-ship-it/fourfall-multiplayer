'use strict';

const ROWS = 6;
const COLS = 7;

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function dropDisc(board, column, player) {
  if (!Number.isInteger(column) || column < 0 || column >= COLS) {
    throw new Error('Choose a column from 1 to 7.');
  }
  if (player !== 1 && player !== 2) {
    throw new Error('Invalid player.');
  }
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][column] === 0) {
      board[row][column] = player;
      return { row, column };
    }
  }
  throw new Error('That column is full. Choose another one.');
}

function outcome(board, row, column) {
  const player = board[row][column];
  if (player !== 1 && player !== 2) return { type: 'playing', winningCells: [] };

  const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of directions) {
    const cells = [{ row, column }];
    for (const sign of [-1, 1]) {
      let r = row + dr * sign;
      let c = column + dc * sign;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
        cells.push({ row: r, column: c });
        r += dr * sign;
        c += dc * sign;
      }
    }
    if (cells.length >= 4) return { type: 'won', winner: player, winningCells: cells };
  }
  if (board[0].every((cell) => cell !== 0)) {
    return { type: 'draw', winner: null, winningCells: [] };
  }
  return { type: 'playing', winner: null, winningCells: [] };
}

module.exports = { ROWS, COLS, emptyBoard, dropDisc, outcome };
