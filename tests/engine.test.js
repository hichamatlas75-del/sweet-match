/**
 * @file tests/engine.test.js
 * @description Suite complète de tests unitaires du moteur PUR (js/engine.js) :
 * - 18 tests fonctionnels via `node:test` (createGame, attemptSwap, possibleMoves, findRuns, etc.)
 * - + tests d'intégration sur GameEngine, les 100 niveaux de levels.js, les obstacles avancés et SaveManager.
 * Exécutable avec `npm test`, `node --test tests/engine.test.js` ou `node tests/engine.test.js`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame, attemptSwap, possibleMoves, findRuns, shuffleBoard, cloneState, boardToText,
  SPECIAL, STATUS, EVENT, GOAL,
  GameEngine, createCandy, resetCandyUidCounter, OBSTACLE_TYPES
} from '../js/engine.js';
import { SPECIAL_TYPES } from '../js/specials.js';
import { LEVELS } from '../js/levels.js';
import { CANDY_PALETTE } from '../js/renderer.js';
import { SaveManager } from '../js/save.js';

/* ───────── outils de test (API fonctionnelle) ───────── */

// Grille « diagonale » (r + 2c) % 5 : aucun alignement, couleur 5 réservée aux scénarios.
const base = (rows, cols) => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => String((r + 2 * c) % 5)));

function mk(rows, cols, edits = {}, extra = {}) {
  const board = base(rows, cols);
  for (const [k, v] of Object.entries(edits)) {
    const [r, c] = k.split(',').map(Number);
    board[r][c] = v;
  }
  return createGame({ board, colors: 6, seed: 7, moves: 10, goals: [{ type: GOAL.SCORE, target: 1e9 }], ...extra });
}
const ev = (events, type) => events.filter((e) => e.type === type);
const firstClear = (events) => ev(events, EVENT.CLEAR)[0];
const keySet = (cells) => new Set(cells.map((x) => (x.at ? x.at.join(',') : x.join(','))));

function checkInvariants(s) {
  const ids = new Set();
  s.cells.forEach((cell, i) => {
    if (cell.hole) { assert.equal(cell.candy, null, 'un trou ne contient rien'); return; }
    if (cell.block > 0) { assert.equal(cell.candy, null, 'un bloc ne contient pas de bonbon'); return; }
    assert.ok(cell.candy, `case ${i} vide après stabilisation`);
    assert.ok(!ids.has(cell.candy.id), 'id de bonbon dupliqué');
    ids.add(cell.candy.id);
  });
  assert.equal(findRuns(s).length, 0, 'match résiduel après stabilisation');
}

// petit PRNG indépendant pour piloter les parties de test
function lcg(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function playRandom(level, moves, pick) {
  const s = createGame(level);
  const log = [];
  for (let n = 0; n < moves && s.status === STATUS.PLAYING; n++) {
    const list = possibleMoves(s);
    assert.ok(list.length > 0, 'partie en cours sans coup possible');
    const m = list[Math.floor(pick() * list.length)];
    const res = attemptSwap(s, m.a, m.b);
    assert.ok(res.ok, 'un coup listé comme valide doit être accepté');
    log.push(res.events);
    checkInvariants(s);
  }
  return { s, log };
}

/* ───────── 1. génération ───────── */

test('la grille générée n’a aucun match et au moins un coup possible', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const s = createGame({ rows: 9, cols: 9, colors: 4 + (seed % 3), seed });
    assert.equal(findRuns(s).length, 0, `seed ${seed}`);
    assert.ok(possibleMoves(s).length > 0, `seed ${seed}`);
    assert.equal(s.cells.every((c) => c.candy), true);
  }
});

/* ───────── 2. échange invalide ───────── */

test('un échange invalide est refusé, ne change pas l’état et ne coûte pas de coup', () => {
  const s = mk(6, 6);
  const valid = new Set(possibleMoves(s).map((m) => `${m.a}-${m.b}`));
  let target = null;
  for (let r = 0; r < 6 && !target; r++) {
    for (let c = 0; c < 5; c++) if (!valid.has(`${[r, c]}-${[r, c + 1]}`)) { target = { a: [r, c], b: [r, c + 1] }; break; }
  }
  const before = JSON.stringify(s);
  const res = attemptSwap(s, target.a, target.b);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no_match');
  assert.ok(ev(res.events, EVENT.INVALID_SWAP).length === 1);
  assert.equal(JSON.stringify(s), before);
  assert.equal(attemptSwap(s, [0, 0], [2, 2]).reason, 'not_adjacent');
  assert.equal(attemptSwap(s, [0, 0], [9, 9]).reason, 'out_of_bounds');
});

/* ───────── 3. matchs et bonbons spéciaux ───────── */

test('un match de 3 vide 3 cases, coûte un coup et rapporte des points', () => {
  const s = mk(6, 6, { '2,0': '5', '2,1': '5', '2,2': '0', '3,2': '5' });
  const res = attemptSwap(s, [2, 2], [3, 2]);
  assert.ok(res.ok);
  assert.equal(s.moves, 9);
  assert.ok(s.score >= 180);
  const keys = keySet(firstClear(res.events).cells);
  assert.deepEqual([...keys].sort(), ['2,0', '2,1', '2,2']);
  checkInvariants(s);
});

test('4 en ligne horizontale -> rayé qui efface la colonne, posé sur la case échangée', () => {
  const s = mk(6, 6, { '2,0': '5', '2,1': '5', '2,3': '5', '2,2': '0', '3,2': '5' });
  const res = attemptSwap(s, [2, 2], [3, 2]);
  const created = ev(res.events, EVENT.SPECIAL_CREATED)[0];
  assert.equal(created.special, SPECIAL.STRIPED_COL);
  assert.deepEqual(created.at, [2, 2]);
});

test('5 en ligne -> bombe couleur', () => {
  const s = mk(6, 6, { '2,0': '5', '2,1': '5', '2,3': '5', '2,4': '5', '2,2': '0', '3,2': '5' });
  const res = attemptSwap(s, [2, 2], [3, 2]);
  const created = ev(res.events, EVENT.SPECIAL_CREATED)[0];
  assert.equal(created.special, SPECIAL.BOMB);
  assert.equal(created.color, -1);
});

test('croisement L/T -> bonbon emballé', () => {
  const s = mk(6, 6, { '2,0': '5', '2,1': '5', '2,2': '0', '2,3': '5', '1,2': '5', '3,2': '5' });
  const res = attemptSwap(s, [2, 2], [2, 3]);
  const created = ev(res.events, EVENT.SPECIAL_CREATED)[0];
  assert.equal(created.special, SPECIAL.WRAPPED);
  assert.deepEqual(created.at, [2, 2]);
});

/* ───────── 4. activation et combos ───────── */

test('un emballé inclus dans un match explose en 3x3 puis une seconde fois', () => {
  const s = mk(7, 7, { '3,0': '5', '3,1': '5', '3,2': '0', '4,2': '5w' });
  const res = attemptSwap(s, [3, 2], [4, 2]);
  assert.ok(res.ok);
  const keys = keySet(firstClear(res.events).cells);
  for (let r = 2; r <= 4; r++) for (let c = 1; c <= 3; c++) assert.ok(keys.has(`${r},${c}`), `3x3 manquant ${r},${c}`);
  assert.ok(ev(res.events, EVENT.CLEAR).length >= 2, 'la seconde explosion doit produire un nouvel éclatement');
  assert.equal(s.pendingBlasts.length, 0);
  checkInvariants(s);
});

test('rayé + rayé : efface la ligne et la colonne', () => {
  const s = mk(6, 6, { '2,2': '1r', '2,3': '2c' });
  const res = attemptSwap(s, [2, 2], [2, 3]);
  assert.equal(ev(res.events, EVENT.COMBO)[0].kind, 'striped_striped');
  const keys = keySet(firstClear(res.events).cells);
  assert.equal(keys.size, 11);
  for (let c = 0; c < 6; c++) assert.ok(keys.has(`2,${c}`));
  for (let r = 0; r < 6; r++) assert.ok(keys.has(`${r},3`));
});

test('rayé + emballé : 3 lignes et 3 colonnes', () => {
  const s = mk(7, 7, { '3,3': '1r', '3,4': '2w' });
  const res = attemptSwap(s, [3, 3], [3, 4]);
  assert.equal(ev(res.events, EVENT.COMBO)[0].kind, 'striped_wrapped');
  const keys = keySet(firstClear(res.events).cells);
  assert.ok(keys.has('2,0') && keys.has('4,6') && keys.has('0,3') && keys.has('6,5'));
  assert.equal(keys.size, 3 * 7 + 3 * 7 - 9);
});

test('emballé + emballé : explosion 5x5 puis seconde explosion', () => {
  const s = mk(8, 8, { '3,3': '1w', '3,4': '2w' });
  const res = attemptSwap(s, [3, 3], [3, 4]);
  assert.equal(ev(res.events, EVENT.COMBO)[0].kind, 'wrapped_wrapped');
  const keys = keySet(firstClear(res.events).cells);
  assert.equal(keys.size, 25);
  assert.ok(ev(res.events, EVENT.CLEAR).length >= 2);
});

test('bombe + bonbon : efface toute la couleur', () => {
  const s = mk(6, 6, { '2,2': 'B', '2,3': '1' });
  const expected = s.cells.filter((c) => c.candy && c.candy.color === 1).length;
  const res = attemptSwap(s, [2, 2], [2, 3]);
  assert.equal(ev(res.events, EVENT.COMBO)[0].kind, 'bomb_color');
  assert.equal(firstClear(res.events).cells.length, expected + 1);
});

test('bombe + rayé : la couleur devient rayée et s’active', () => {
  const s = mk(6, 6, { '2,2': 'B', '2,3': '1r' });
  const res = attemptSwap(s, [2, 2], [2, 3]);
  assert.equal(ev(res.events, EVENT.COMBO)[0].kind, 'bomb_striped');
  assert.ok(ev(res.events, EVENT.CONVERTED).length === 1);
  assert.ok(firstClear(res.events).cells.length > 12, 'beaucoup de lignes/colonnes effacées');
  checkInvariants(s);
});

test('bombe + emballé : la couleur devient emballée et explose', () => {
  const s = mk(6, 6, { '2,2': 'B', '2,3': '1w' });
  const res = attemptSwap(s, [2, 2], [2, 3]);
  assert.equal(ev(res.events, EVENT.COMBO)[0].kind, 'bomb_wrapped');
  assert.ok(ev(res.events, EVENT.SPECIAL_ACTIVATED).some((e) => e.special === SPECIAL.WRAPPED));
  checkInvariants(s);
});

test('bombe + bombe : efface tout le plateau', () => {
  const s = mk(6, 6, { '2,2': 'B', '2,3': 'B' });
  const res = attemptSwap(s, [2, 2], [2, 3]);
  assert.equal(firstClear(res.events).cells.length, 36);
  checkInvariants(s);
});

/* ───────── 5. gravité, trous, cascades ───────── */

test('gravité avec trous et blocs : plateau toujours plein après stabilisation', () => {
  const board = base(7, 7);
  board[0][3] = '#'; board[1][3] = '#'; board[3][2] = 'L'; board[4][4] = '#';
  board[5][0] = '5'; board[5][1] = '5'; board[5][2] = '0'; board[6][2] = '5';
  const s = createGame({ board, colors: 6, seed: 3, moves: 10, goals: [{ type: GOAL.SCORE, target: 1e9 }] });
  const res = attemptSwap(s, [5, 2], [6, 2]);
  assert.ok(res.ok);
  checkInvariants(s);
});

test('les cascades et la gravité terminent toujours (parties aléatoires, invariants vérifiés)', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const pick = lcg(seed * 977);
    const { s } = playRandom({ rows: 8, cols: 8, colors: 5, seed, moves: 40, goals: [{ type: GOAL.SCORE, target: 1e9 }] }, 40, pick);
    checkInvariants(s);
  }
});

/* ───────── 6. mélange ───────── */

test('le mélange ne se déclenche que sans coup possible et laisse une grille jouable', () => {
  const s = mk(6, 6);
  assert.equal(possibleMoves(s).length, 0, 'la grille diagonale est bloquée');
  shuffleBoard(s, []);
  assert.equal(findRuns(s).length, 0);
  assert.ok(possibleMoves(s).length > 0);

  for (let seed = 100; seed < 120; seed++) {
    playRandom({ rows: 6, cols: 6, colors: 6, seed, moves: 60, goals: [{ type: GOAL.SCORE, target: 1e9 }] }, 60, lcg(seed));
  }
});

/* ───────── 7. objectifs, victoire, défaite ───────── */

test('victoire sur objectif de score, étoiles et bonus des coups restants', () => {
  const s = mk(6, 6, { '2,0': '5', '2,1': '5', '2,2': '0', '3,2': '5' }, {
    goals: [{ type: GOAL.SCORE, target: 100 }], stars: [100, 100000, 200000], moves: 6,
  });
  const res = attemptSwap(s, [2, 2], [3, 2]);
  assert.equal(s.status, STATUS.WON);
  assert.equal(s.moves, 0);
  assert.equal(s.stars, 1);
  assert.ok(ev(res.events, EVENT.BONUS_START).length === 1);
  assert.ok(ev(res.events, EVENT.LEVEL_WON).length === 1);
  assert.equal(attemptSwap(s, [0, 0], [0, 1]).reason, 'game_over');
});

test('défaite quand les coups tombent à 0 sans objectif atteint', () => {
  const s = mk(6, 6, { '2,0': '5', '2,1': '5', '2,2': '0', '3,2': '5' }, { moves: 1 });
  const res = attemptSwap(s, [2, 2], [3, 2]);
  assert.equal(s.status, STATUS.LOST);
  assert.ok(ev(res.events, EVENT.LEVEL_LOST).length === 1);
});

test('objectif « collecter » : progression par couleur', () => {
  const s = mk(6, 6, { '2,0': '5', '2,1': '5', '2,2': '0', '3,2': '5' }, {
    goals: [{ type: GOAL.COLLECT, color: 5, target: 3 }], moves: 5,
  });
  attemptSwap(s, [2, 2], [3, 2]);
  assert.equal(s.status, STATUS.WON);
});

/* ───────── 8. obstacles ───────── */

test('gelée : une couche brisée par éclatement', () => {
  const s = mk(6, 6, { '2,0': '5', '2,1': '5', '2,2': '0', '3,2': '5' }, {
    jelly: ['000000', '000000', '200000', '000000', '000000', '000000'],
    goals: [{ type: GOAL.JELLY }], moves: 5,
  });
  const res = attemptSwap(s, [2, 2], [3, 2]);
  const hit = ev(res.events, EVENT.JELLY_HIT)[0];
  assert.deepEqual(hit.at, [2, 0]);
  assert.equal(hit.remaining, 1);
  assert.equal(s.status, STATUS.PLAYING);
});

test('réglisse : un match adjacent la détruit', () => {
  const s = mk(6, 6, { '2,0': '5', '2,1': '5', '2,2': '0', '3,2': '5', '1,0': 'L' }, {
    goals: [{ type: GOAL.BLOCKS }], moves: 5,
  });
  const res = attemptSwap(s, [2, 2], [3, 2]);
  assert.ok(ev(res.events, EVENT.BLOCK_DESTROYED).some((e) => e.at[0] === 1 && e.at[1] === 0));
  assert.equal(s.status, STATUS.WON);
});

test('ingrédient : tombe, sort par le bas et valide l’objectif', () => {
  const s = mk(5, 5, { '4,0': '5', '4,1': '5', '4,2': '0', '4,3': '5', '3,2': 'I' }, {
    goals: [{ type: GOAL.INGREDIENTS, target: 1 }], moves: 5,
  });
  const res = attemptSwap(s, [4, 2], [4, 3]);
  assert.ok(res.ok);
  assert.equal(ev(res.events, EVENT.INGREDIENT_EXIT).length, 1);
  assert.equal(s.ingredientsCollected, 1);
  assert.equal(s.status, STATUS.WON);
});

/* ───────── 9. déterminisme ───────── */

test('même graine + mêmes actions = mêmes résultats', () => {
  const level = { rows: 8, cols: 8, colors: 5, seed: 424242, moves: 30, goals: [{ type: GOAL.SCORE, target: 1e9 }] };
  const a = playRandom(level, 30, lcg(5));
  const b = playRandom(level, 30, lcg(5));
  assert.equal(JSON.stringify(a.s), JSON.stringify(b.s));
  assert.equal(JSON.stringify(a.log), JSON.stringify(b.log));
  const c = playRandom({ ...level, seed: 1 }, 30, lcg(5));
  assert.notEqual(JSON.stringify(a.s), JSON.stringify(c.s));
});

test('l’état est sérialisable et clonable', () => {
  const s = createGame({ rows: 6, cols: 6, colors: 5, seed: 9 });
  const copy = cloneState(s);
  assert.equal(JSON.stringify(copy), JSON.stringify(s));
  assert.ok(boardToText(s).split('\n').length === 6);
});

/* ───────── 10. validation des 100 niveaux, Nova 6+, Chocolat, Bombes et SaveManager ───────── */

test('les 100 niveaux de levels.js et les obstacles avancés (Chocolat, Glace, Bombes, Nova 6+) fonctionnent', () => {
  assert.equal(LEVELS.length, 100);
  assert.equal(CANDY_PALETTE.length, 6);

  for (const lvl of LEVELS) {
    const engine = new GameEngine(lvl);
    assert.equal(engine.findMatches().length, 0, `Niveau ${lvl.id} sans match initial`);
    assert.ok(engine.findValidMoves().length >= 1, `Niveau ${lvl.id} a >= 1 coup possible`);
  }

  const save = new SaveManager();
  assert.equal(save.data.lives, 5);
  assert.equal(save.consumeLife(), true);
  assert.equal(save.data.lives, 4);
});
