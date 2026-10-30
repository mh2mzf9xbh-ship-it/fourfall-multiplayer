'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROWS, COLS, emptyBoard, dropDisc, outcome } = require('../game');

test('new board is 6x7 with no discs', () => {
  const board = emptyBoard();
  assert.equal(board.length, ROWS);
  assert(board.every((row) => row.length === COLS && row.every((v) => v === 0)));
  board[0][0] = 2;
  assert.equal(emptyBoard()[0][0], 0, 'fresh boards must not share cells');
});

test('discs drop to the bottom and stack upwards', () => {
  const board = emptyBoard();
  assert.deepEqual(dropDisc(board, 3, 1), { row: 5, column: 3 });
  assert.deepEqual(dropDisc(board, 3, 2), { row: 4, column: 3 });
  for (let i = 0; i < 4; i++) dropDisc(board, 3, 1);
  assert.throws(() => dropDisc(board, 3, 1), /full/i);
});

test('invalid columns and invalid players are rejected', () => {
  const board = emptyBoard();
  for (const col of [-1, 7, 1.5, NaN, '3']) assert.throws(() => dropDisc(board, col, 1));
  assert.throws(() => dropDisc(board, 1, 4));
});

test('horizontal, vertical and both diagonal wins are detected', () => {
  const patterns = [
    [[5, 0], [5, 1], [5, 2], [5, 3]],
    [[2, 4], [3, 4], [4, 4], [5, 4]],
    [[2, 1], [3, 2], [4, 3], [5, 4]],
    [[2, 4], [3, 3], [4, 2], [5, 1]],
  ];
  for (const pattern of patterns) {
    const board = emptyBoard();
    for (const [r, c] of pattern) board[r][c] = 2;
    const [r, c] = pattern[3];
    const result = outcome(board, r, c);
    assert.equal(result.type, 'won');
    assert.equal(result.winner, 2);
    assert.deepEqual(new Set(result.winningCells.map((v) => `${v.row}:${v.column}`)), new Set(pattern.map(([rr, cc]) => `${rr}:${cc}`)));
  }
});

test('non-winning and filled board outcomes', () => {
  const board = emptyBoard();
  const last = dropDisc(board, 2, 1);
  assert.equal(outcome(board, last.row, last.column).type, 'playing');
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) board[r][c] = (r + c) % 2 + 1;
  }
  // The outcome check for the last move must also support a completely filled board.
  // These diagonal-friendly test values have no horizontal/vertical run of four.
  // Test a draw with a legal pattern that has no connecting four.
  const nonwinning = [
    [2,2,1,1,2,2,1],
    [1,1,2,2,1,1,2],
    [2,2,1,1,2,2,1],
    [1,1,2,2,1,1,2],
    [2,2,1,1,2,2,1],
    [1,1,2,2,1,1,2],
  ];
  assert.equal(outcome(nonwinning, 5, 0).type, 'draw');
});
