/**
 * Sudoku — script.js
 * Production-quality single-file JavaScript for the Sudoku app.
 *
 * Architecture (top → bottom):
 *   1. UTILS          — helpers used everywhere
 *   2. ENGINE         — pure Sudoku logic (no DOM)
 *   3. AUDIO          — Web Audio API sound effects
 *   4. STATE          — encapsulated game state + localStorage persistence
 *   5. RENDERER       — all DOM manipulation (surgical updates)
 *   6. CONFETTI       — canvas win animation
 *   7. CONTROLLER     — wires everything: events, game flow, keyboard
 */

'use strict';

/* ══════════════════════════════════════════════════════════════
   1. UTILS
══════════════════════════════════════════════════════════════ */

/** Format seconds into m:ss */
function fmtTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/** Get element by ID */
const $ = id => document.getElementById(id);

/**
 * Add a CSS class, wait for animationend, then remove.
 * Forces reflow so re-triggering works correctly.
 */
function triggerAnim(el, cls, duration = 600) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // reflow
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), duration);
}

/* ══════════════════════════════════════════════════════════════
   2. ENGINE — pure Sudoku logic, zero DOM
══════════════════════════════════════════════════════════════ */

/** In-place Fisher-Yates shuffle */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Check whether placing `num` at (row, col) on `board` is valid.
 * Does NOT consider the cell's own current value.
 * @param {number[][]} board
 * @param {number} row
 * @param {number} col
 * @param {number} num
 * @returns {boolean}
 */
function isValidPlacement(board, row, col, num) {
  // Row check
  for (let c = 0; c < 9; c++) {
    if (board[row][c] === num) return false;
  }
  // Column check
  for (let r = 0; r < 9; r++) {
    if (board[r][col] === num) return false;
  }
  // 3×3 box check
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (board[boxRow + r][boxCol + c] === num) return false;
    }
  }
  return true;
}

/**
 * Backtracking solver.
 * @param {number[][]} board  Mutated in-place.
 * @param {boolean} randomize  Shuffle digit order (for generation).
 * @returns {boolean} true if solved.
 */
function solveBoard(board, randomize = false) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] !== 0) continue;
      const digits = randomize ? shuffle([1,2,3,4,5,6,7,8,9]) : [1,2,3,4,5,6,7,8,9];
      for (const n of digits) {
        if (isValidPlacement(board, r, c, n)) {
          board[r][c] = n;
          if (solveBoard(board, randomize)) return true;
          board[r][c] = 0;
        }
      }
      return false; // no valid digit → backtrack
    }
  }
  return true; // all cells filled
}

/**
 * Count solutions, stopping at `limit` (default 2 — for uniqueness check).
 * @param {number[][]} board
 * @param {{ v: number }} counter
 * @param {number} limit
 * @returns {number}
 */
function countSolutions(board, counter = { v: 0 }, limit = 2) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] !== 0) continue;
      for (let n = 1; n <= 9; n++) {
        if (isValidPlacement(board, r, c, n)) {
          board[r][c] = n;
          countSolutions(board, counter, limit);
          board[r][c] = 0;
          if (counter.v >= limit) return counter.v;
        }
      }
      return counter.v; // cell has no valid digit → dead end
    }
  }
  counter.v++;
  return counter.v;
}

/** Generate a complete, randomised, valid Sudoku solution grid. */
function generateSolution() {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  solveBoard(board, true);
  return board;
}

/**
 * Carve a puzzle from a solution by removing cells while
 * guaranteeing a unique solution.
 * @param {number[][]} solution
 * @param {number} removals  Number of cells to blank.
 * @returns {number[][]}
 */
function carvePuzzle(solution, removals) {
  const puzzle = solution.map(r => [...r]);
  const indices = shuffle([...Array(81).keys()]);
  let removed = 0;

  for (const idx of indices) {
    if (removed >= removals) break;
    const r = Math.floor(idx / 9);
    const c = idx % 9;
    const backup = puzzle[r][c];
    puzzle[r][c] = 0;

    // Ensure uniqueness is preserved
    const copy = puzzle.map(row => [...row]);
    if (countSolutions(copy) === 1) {
      removed++;
    } else {
      puzzle[r][c] = backup; // restore — puzzle would lose uniqueness
    }
  }
  return puzzle;
}

/**
 * Smart hint using Minimum Remaining Values (MRV) heuristic.
 * Returns the most-constrained empty cell.
 * @param {number[][]} puzzle
 * @param {number[][]} solution
 * @returns {{ r: number, c: number, val: number } | null}
 */
function getSmartHint(puzzle, solution) {
  let best = null;
  let fewest = Infinity;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (puzzle[r][c] !== 0) continue;
      let candidates = 0;
      for (let n = 1; n <= 9; n++) {
        if (isValidPlacement(puzzle, r, c, n)) candidates++;
      }
      if (candidates < fewest) {
        fewest = candidates;
        best = { r, c, val: solution[r][c] };
      }
    }
  }
  return best;
}

/** Number of cells to remove per difficulty. */
const REMOVALS_BY_DIFF = { easy: 30, medium: 44, hard: 52, expert: 58 };

/* ══════════════════════════════════════════════════════════════
   3. AUDIO — Web Audio API, zero audio files
══════════════════════════════════════════════════════════════ */

const Audio = (() => {
  let ctx = null;
  let enabled = true;

  /** Lazily initialise AudioContext (browsers require user gesture) */
  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /**
   * Play a synthetic tone.
   * @param {number} freq   Hz
   * @param {string} type   OscillatorType
   * @param {number} vol    0–1
   * @param {number} attack seconds
   * @param {number} decay  seconds
   */
  function tone(freq, type, vol, attack, decay) {
    if (!enabled) return;
    try {
      const c = getCtx();
      const osc  = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      osc.type = type;
      osc.frequency.value = freq;
      const t = c.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
      osc.start(t);
      osc.stop(t + attack + decay + 0.05);
    } catch (_) { /* silently skip if unsupported */ }
  }

  return {
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; },

    correct()  { tone(523, 'sine', 0.14, 0.01, 0.12); setTimeout(() => tone(659, 'sine', 0.10, 0.01, 0.14), 90); },
    wrong()    { tone(180, 'sawtooth', 0.08, 0.01, 0.20); },
    select()   { tone(440, 'sine', 0.04, 0.005, 0.06); },
    hint()     { tone(600, 'triangle', 0.09, 0.01, 0.22); setTimeout(() => tone(800, 'triangle', 0.05, 0.01, 0.22), 130); },
    erase()    { tone(320, 'triangle', 0.05, 0.005, 0.09); },
    win()      { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 'sine', 0.12, 0.01, 0.28), i * 130)); },
    note()     { tone(700, 'sine', 0.03, 0.005, 0.05); },
  };
})();

/* ══════════════════════════════════════════════════════════════
   4. STATE — encapsulated, persistence via localStorage
══════════════════════════════════════════════════════════════ */

const STORE = {
  GAME:  'sudoku_game_v4',
  STATS: 'sudoku_stats_v4',
  PREFS: 'sudoku_prefs_v1',
};

const MAX_LIVES = 3;

/** Empty 9×9 notes array (each cell = Set of pencil digits) */
function emptyNotes() {
  return Array.from({ length: 9 }, () =>
    Array.from({ length: 9 }, () => new Set())
  );
}

/** JSON-serialise notes (Sets → arrays) */
function serNotes(notes) {
  return notes.map(row => row.map(cell => [...cell]));
}

/** JSON-deserialise notes (arrays → Sets) */
function desNotes(raw) {
  return raw.map(row => row.map(cell => new Set(cell)));
}

/**
 * GameState — single source of truth.
 * All mutations go through methods; external code never writes directly.
 */
class GameState {
  constructor() { this._init(); }

  /** ── Private initialiser ── */
  _init() {
    this._puzzle   = null;   // number[][] — working board (0 = empty)
    this._solution = null;   // number[][] — full solution
    this._given    = null;   // number[][] — original clues (non-zero = immutable)
    this._notes    = null;   // Set[][] — pencil marks per cell
    this._selected = null;   // [r, c] | null
    this._mistakes = 0;
    this._lives    = MAX_LIVES;
    this._noteMode = false;
    this._seconds  = 0;
    this._over     = false;
    this._diff     = 'medium';
    this._history  = [];     // undo stack [{r,c,prevVal,prevNotes}]
  }

  /* ── Getters ── */
  get puzzle()    { return this._puzzle; }
  get solution()  { return this._solution; }
  get given()     { return this._given; }
  get notes()     { return this._notes; }
  get selected()  { return this._selected; }
  get mistakes()  { return this._mistakes; }
  get lives()     { return this._lives; }
  get maxLives()  { return MAX_LIVES; }
  get noteMode()  { return this._noteMode; }
  get seconds()   { return this._seconds; }
  get over()      { return this._over; }
  get diff()      { return this._diff; }
  get histLen()   { return this._history.length; }

  get selValue() {
    if (!this._selected) return 0;
    const [r, c] = this._selected;
    return this._puzzle[r][c];
  }

  get selIsGiven() {
    if (!this._selected) return false;
    const [r, c] = this._selected;
    return this._given[r][c] !== 0;
  }

  /** How many of digit `n` are correctly placed on the board */
  digitPlaced(n) {
    let count = 0;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (this._puzzle[r][c] === n && this._solution[r][c] === n) count++;
    return count;
  }

  /* ── Mutations ── */

  /** Fully initialise a new game. */
  startGame({ puzzle, solution, diff }) {
    this._init();
    this._puzzle   = puzzle;
    this._solution = solution;
    this._given    = puzzle.map(r => [...r]);
    this._notes    = emptyNotes();
    this._diff     = diff;
    this._save();
  }

  setSelected(r, c) { this._selected = [r, c]; }
  clearSelected()   { this._selected = null; }
  setDiff(d)        { this._diff = d; }

  toggleNoteMode() { this._noteMode = !this._noteMode; }

  moveSelected(dr, dc) {
    if (!this._selected) return;
    const [r, c] = this._selected;
    this._selected = [
      Math.max(0, Math.min(8, r + dr)),
      Math.max(0, Math.min(8, c + dc)),
    ];
  }

  /** Increment timer and persist every 10s. */
  tickTimer() {
    if (this._over) return;
    this._seconds++;
    if (this._seconds % 10 === 0) this._save();
  }

  /**
   * Enter a digit into the selected cell.
   * @param {number} num 1–9
   * @returns {{ type: string, r: number, c: number, fatal?: boolean }}
   */
  enterDigit(num) {
    if (!this._selected || this._over) return { type: 'noop' };
    const [r, c] = this._selected;
    if (this._given[r][c] !== 0) return { type: 'given' };

    /* Notes mode */
    if (this._noteMode) {
      const snap = [...this._notes[r][c]];
      const ns = this._notes[r][c];
      if (ns.has(num)) ns.delete(num); else ns.add(num);
      this._puzzle[r][c] = 0;
      this._pushHistory(r, c, 0, snap);
      this._save();
      return { type: 'note', r, c };
    }

    /* Normal placement */
    const prevVal   = this._puzzle[r][c];
    const prevNotes = [...this._notes[r][c]];
    this._pushHistory(r, c, prevVal, prevNotes);

    this._notes[r][c].clear();

    // Toggle off if same digit tapped twice
    if (this._puzzle[r][c] === num) {
      this._puzzle[r][c] = 0;
      this._save();
      return { type: 'erase', r, c };
    }

    const correct = num === this._solution[r][c];
    this._puzzle[r][c] = num;

    if (!correct) {
      this._mistakes++;
      this._lives = Math.max(0, this._lives - 1);
      if (this._lives === 0) {
        this._over = true;
        this._save();
        return { type: 'wrong', r, c, fatal: true };
      }
    }

    this._save();
    return { type: correct ? 'correct' : 'wrong', r, c, fatal: false };
  }

  /** Erase the selected cell (value + notes). Returns true if something changed. */
  erase() {
    if (!this._selected || this._over) return false;
    const [r, c] = this._selected;
    if (this._given[r][c] !== 0) return false;
    const prevVal   = this._puzzle[r][c];
    const prevNotes = [...this._notes[r][c]];
    if (prevVal === 0 && prevNotes.length === 0) return false;
    this._pushHistory(r, c, prevVal, prevNotes);
    this._puzzle[r][c] = 0;
    this._notes[r][c].clear();
    this._save();
    return true;
  }

  /** Pop the last history entry and restore it. Returns changed cell or null. */
  undo() {
    if (!this._history.length || this._over) return null;
    const { r, c, prevVal, prevNotes } = this._history.pop();
    this._puzzle[r][c] = prevVal;
    this._notes[r][c]  = new Set(prevNotes);
    this._selected = [r, c];
    this._save();
    return { r, c };
  }

  /** Fill a cell with the solution value (hint). */
  applyHint(r, c) {
    const prevVal   = this._puzzle[r][c];
    const prevNotes = [...this._notes[r][c]];
    this._pushHistory(r, c, prevVal, prevNotes);
    this._notes[r][c].clear();
    this._puzzle[r][c] = this._solution[r][c];
    this._selected = [r, c];
    this._save();
  }

  /** Returns true if every cell matches the solution. */
  isSolved() {
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (this._puzzle[r][c] !== this._solution[r][c]) return false;
    return true;
  }

  /** End the current game (no more input). Clears persisted game. */
  endGame() {
    this._over = true;
    try { localStorage.removeItem(STORE.GAME); } catch (_) {}
  }

  /* ── Undo history ── */
  _pushHistory(r, c, prevVal, prevNotes) {
    this._history.push({ r, c, prevVal, prevNotes });
    if (this._history.length > 60) this._history.shift(); // cap memory
  }

  /* ── localStorage persistence ── */
  _save() {
    try {
      const data = {
        puzzle:   this._puzzle,
        solution: this._solution,
        given:    this._given,
        notes:    serNotes(this._notes),
        selected: this._selected,
        mistakes: this._mistakes,
        lives:    this._lives,
        noteMode: this._noteMode,
        seconds:  this._seconds,
        over:     this._over,
        diff:     this._diff,
        history:  this._history,
      };
      localStorage.setItem(STORE.GAME, JSON.stringify(data));
    } catch (_) { /* storage unavailable — continue gracefully */ }
  }

  /** Restore saved game. Returns true if successful. */
  restore() {
    try {
      const raw = localStorage.getItem(STORE.GAME);
      if (!raw) return false;
      const d = JSON.parse(raw);
      this._puzzle   = d.puzzle;
      this._solution = d.solution;
      this._given    = d.given;
      this._notes    = desNotes(d.notes);
      this._selected = d.selected ?? null;
      this._mistakes = d.mistakes ?? 0;
      this._lives    = d.lives ?? MAX_LIVES;
      this._noteMode = d.noteMode ?? false;
      this._seconds  = d.seconds ?? 0;
      this._over     = d.over ?? false;
      this._diff     = d.diff ?? 'medium';
      this._history  = d.history ?? [];
      return true;
    } catch (_) { return false; }
  }

  /* ── Statistics ── */
  _defaultStats() {
    return {
      played: 0,
      won: 0,
      streak: 0,
      bestStreak: 0,
      totalTime: 0,
      totalMistakes: 0,
      bestTimes: { easy: null, medium: null, hard: null, expert: null },
    };
  }

  loadStats() {
    try {
      const raw = localStorage.getItem(STORE.STATS);
      return raw ? { ...this._defaultStats(), ...JSON.parse(raw) } : this._defaultStats();
    } catch (_) { return this._defaultStats(); }
  }

  _saveStats(s) {
    try { localStorage.setItem(STORE.STATS, JSON.stringify(s)); } catch (_) {}
  }

  /** Record a win and return updated stats + whether it's a new record. */
  recordWin() {
    const s = this.loadStats();
    s.played++;
    s.won++;
    s.streak++;
    s.bestStreak      = Math.max(s.bestStreak, s.streak);
    s.totalTime      += this._seconds;
    s.totalMistakes  += this._mistakes;
    const diff = this._diff;
    const isRecord   = !s.bestTimes[diff] || this._seconds < s.bestTimes[diff];
    if (isRecord) s.bestTimes[diff] = this._seconds;
    this._saveStats(s);
    return { stats: s, isRecord };
  }

  /** Record a loss. */
  recordLoss() {
    const s = this.loadStats();
    s.played++;
    s.streak = 0;
    s.totalMistakes += this._mistakes;
    this._saveStats(s);
    return s;
  }

  /* ── Preferences ── */
  loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE.PREFS) || '{}'); } catch (_) { return {}; }
  }
  savePref(key, val) {
    try {
      const p = this.loadPrefs();
      p[key] = val;
      localStorage.setItem(STORE.PREFS, JSON.stringify(p));
    } catch (_) {}
  }
}

/* ══════════════════════════════════════════════════════════════
   5. RENDERER — all DOM manipulation, surgical updates
══════════════════════════════════════════════════════════════ */

class Renderer {
  constructor(state) {
    this.state   = state;
    this.cellEls = [];    // [row][col] → HTMLElement

    /* Cache frequently used DOM references */
    this._dom = {
      board:    $('board'),
      timer:    $('timer'),
      mistakes: $('mistakes'),
      numpad:   $('numpad'),
      statusMsg:$('status-msg'),
      btnNote:  $('btn-note'),
      lives:    [$('life-1'), $('life-2'), $('life-3')],
    };

    this._msgTimer = null;
  }

  /* ── Board initialisation (called once) ── */

  /**
   * Build all 81 cell elements once. Attach click handlers.
   * @param {function(r: number, c: number): void} onCellClick
   */
  buildBoard(onCellClick) {
    const board = this._dom.board;
    board.innerHTML = '';
    this.cellEls = [];

    for (let r = 0; r < 9; r++) {
      this.cellEls[r] = [];
      for (let c = 0; c < 9; c++) {
        const el = document.createElement('div');
        el.className = 'cell';
        el.setAttribute('role', 'gridcell');
        el.setAttribute('aria-label', `Row ${r + 1}, Column ${c + 1}`);
        el.setAttribute('tabindex', '-1');

        // Thick box-boundary borders
        if (r === 2 || r === 5) el.classList.add('box-bottom');
        if (r === 8)            el.classList.add('last-row');

        el.addEventListener('click', () => onCellClick(r, c));
        board.appendChild(el);
        this.cellEls[r][c] = el;
      }
    }
  }

  /** Build numpad 1–9 buttons once. */
  buildNumpad(onInput) {
    const pad = this._dom.numpad;
    pad.innerHTML = '';
    for (let n = 1; n <= 9; n++) {
      const btn = document.createElement('button');
      btn.className = 'num-btn';
      btn.setAttribute('aria-label', `Enter ${n}`);
      btn.dataset.n = n;
      btn.innerHTML = `${n}<span class="remaining" id="rem-${n}"></span>`;
      btn.addEventListener('click', () => onInput(n));
      pad.appendChild(btn);
    }
  }

  /* ── Full repaint (game start / restore) ── */

  /** Repaint all 81 cells and update all HUD elements. */
  paintAll() {
    const s = this.state;
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        this._paintCell(r, c);
    this._updateHUD();
    this._updateNumpad();
    this._updateNoteBtn();
    this._updateLives();
  }

  /* ── Surgical updates (after each interaction) ── */

  /**
   * Repaint only specific cells.
   * @param {[number,number][]} coords  Array of [r, c] pairs
   */
  paintCells(coords) {
    for (const [r, c] of coords) this._paintCell(r, c);
  }

  /**
   * Update highlighting when selection changes.
   * Repaints old-selection area and new-selection area only.
   * @param {[number,number] | null} prev  Previous [r, c]
   */
  updateSelection(prev) {
    const affected = new Set();
    if (prev)                 this._related(prev[0], prev[1]).forEach(k => affected.add(k));
    if (this.state.selected)  this._related(this.state.selected[0], this.state.selected[1]).forEach(k => affected.add(k));
    for (const key of affected) {
      const [r, c] = key.split(',').map(Number);
      this._paintCell(r, c);
    }
  }

  /* ── Cell painter (core) ── */

  /** Paint a single cell according to current state. */
  _paintCell(r, c) {
    const el  = this.cellEls[r][c];
    const s   = this.state;
    const val = s.puzzle[r][c];
    const isGiven = s.given[r][c] !== 0;

    // Remove all state classes (keep structural ones)
    el.classList.remove(
      'given', 'user-val', 'error', 'selected',
      'highlight', 'highlight-same', 'notes-mode'
    );
    el.innerHTML = '';

    /* ── Value rendering ── */
    if (isGiven) {
      el.classList.add('given');
      el.textContent = val;
    } else if (val !== 0) {
      el.classList.add('user-val');
      if (val !== s.solution[r][c]) el.classList.add('error');
      el.textContent = val;
    } else {
      // Notes
      const ns = s.notes[r][c];
      if (ns.size > 0) {
        el.classList.add('notes-mode');
        for (let n = 1; n <= 9; n++) {
          const span = document.createElement('span');
          span.className   = 'note-digit';
          span.textContent = ns.has(n) ? n : '';
          span.setAttribute('aria-hidden', 'true');
          el.appendChild(span);
        }
      }
    }

    /* ── Selection / highlight ── */
    if (s.selected) {
      const [sr, sc] = s.selected;
      if (sr === r && sc === c) {
        el.classList.add('selected');
      } else {
        const sameRow = sr === r;
        const sameCol = sc === c;
        const sameBox = Math.floor(sr / 3) === Math.floor(r / 3) &&
                        Math.floor(sc / 3) === Math.floor(c / 3);
        if (sameRow || sameCol || sameBox) el.classList.add('highlight');

        // Highlight same digit
        const selVal = s.puzzle[sr][sc];
        if (selVal !== 0 && val === selVal) el.classList.add('highlight-same');
      }
    }

    /* ── ARIA label ── */
    const aVal = val !== 0 ? String(val) : 'empty';
    el.setAttribute('aria-label',
      `Row ${r + 1}, Column ${c + 1}: ${aVal}${isGiven ? ' (given)' : ''}`
    );
  }

  /* ── HUD updates ── */

  _updateHUD() {
    const s = this.state;
    this._dom.timer.textContent    = fmtTime(s.seconds);
    this._dom.mistakes.textContent = s.mistakes;
    this._dom.mistakes.classList.toggle('has-mistakes', s.mistakes > 0);
  }

  updateTimer() {
    this._dom.timer.textContent = fmtTime(this.state.seconds);
  }

  _updateNumpad() {
    for (let n = 1; n <= 9; n++) {
      const btn  = this._dom.numpad.querySelector(`[data-n="${n}"]`);
      const remEl = $(`rem-${n}`);
      if (!btn) continue;
      const placed    = this.state.digitPlaced(n);
      const remaining = 9 - placed;
      btn.classList.toggle('exhausted', remaining === 0);
      btn.setAttribute('aria-disabled', remaining === 0 ? 'true' : 'false');
      if (remEl) remEl.textContent = remaining < 9 ? remaining : '';
    }
  }

  _updateNoteBtn() {
    const on = this.state.noteMode;
    this._dom.btnNote.classList.toggle('on', on);
    this._dom.btnNote.setAttribute('aria-pressed', on ? 'true' : 'false');
    this._dom.btnNote.textContent = on ? 'Notes ✓' : 'Notes';
  }

  _updateLives() {
    const { lives, maxLives } = this.state;
    this._dom.lives.forEach((el, i) => {
      el.classList.toggle('lost', i >= lives);
    });
  }

  /** Flash lost life heart. */
  loseLife(livesLeft) {
    const lostIdx = livesLeft; // 0-based index of the heart that was just lost
    const el = this._dom.lives[lostIdx];
    if (el) triggerAnim(el, 'breaking', 500);
  }

  /** Shortcut: full HUD + numpad refresh */
  updateHUDFull() {
    this._updateHUD();
    this._updateNumpad();
    this._updateLives();
  }

  /* ── Animations ── */

  shakeCell(r, c)     { triggerAnim(this.cellEls[r][c], 'shake', 400); }
  popCell(r, c)       { triggerAnim(this.cellEls[r][c], 'pop', 280); }
  hintCell(r, c)      { triggerAnim(this.cellEls[r][c], 'hint-anim', 1300); }
  flashCells(coords)  { coords.forEach(([r, c]) => triggerAnim(this.cellEls[r][c], 'group-flash', 600)); }

  /* ── Status message ── */

  setMsg(text, type = '', duration = 3000) {
    const el = this._dom.statusMsg;
    el.textContent = text;
    el.className   = `status-msg${type ? ' ' + type : ''}`;
    if (this._msgTimer) clearTimeout(this._msgTimer);
    if (duration > 0) {
      this._msgTimer = setTimeout(() => {
        el.textContent = '';
        el.className   = 'status-msg';
      }, duration);
    }
  }

  clearMsg() {
    const el = this._dom.statusMsg;
    el.textContent = '';
    el.className   = 'status-msg';
    clearTimeout(this._msgTimer);
  }

  /* ── Keyboard focus ── */

  setTabFocus(r, c) {
    for (let row = 0; row < 9; row++)
      for (let col = 0; col < 9; col++)
        this.cellEls[row][col].setAttribute('tabindex', row === r && col === c ? '0' : '-1');
    this.cellEls[r][c].focus({ preventScroll: true });
  }

  /* ── Modals ── */

  _showModal(id) {
    const el = $(id);
    el.setAttribute('aria-hidden', 'false');
    el.classList.add('show');
    const firstBtn = el.querySelector('button, [tabindex]');
    if (firstBtn) setTimeout(() => firstBtn.focus(), 50);
  }

  _hideModal(id) {
    const el = $(id);
    el.setAttribute('aria-hidden', 'true');
    el.classList.remove('show');
  }

  showWin(isRecord) {
    const { seconds, mistakes, diff } = this.state;
    const { stats } = this.state.recordWin();
    const row = $('win-stats-row');
    row.innerHTML = [
      { label: 'Time',   val: fmtTime(seconds),  accent: isRecord },
      { label: 'Errors', val: mistakes,           accent: false },
      { label: 'Streak', val: `${stats.streak} 🔥`, accent: true },
    ].map(({ label, val, accent }) => `
      <div class="modal-stat">
        <div class="modal-stat-label">${label}</div>
        <div class="modal-stat-value${accent ? ' accent' : ''}">${val}</div>
      </div>
    `).join('');
    $('win-sub').textContent = isRecord
      ? `🏆 New personal record on ${diff}!`
      : 'Well done — puzzle solved!';
    this._showModal('win-modal');
  }

  showGameover() {
    const { seconds, mistakes } = this.state;
    $('go-stats-row').innerHTML = `
      <div class="modal-stat"><div class="modal-stat-label">Time</div><div class="modal-stat-value">${fmtTime(seconds)}</div></div>
      <div class="modal-stat"><div class="modal-stat-label">Errors</div><div class="modal-stat-value">${mistakes}</div></div>
    `;
    this._hideModal('win-modal');
    this._showModal('gameover-modal');
  }

  showStats() {
    const s         = this.state.loadStats();
    const winRate   = s.played ? Math.round((s.won / s.played) * 100) : 0;
    const avgTime   = s.won    ? Math.round(s.totalTime / s.won)       : 0;

    $('stats-grid').innerHTML = [
      { label: 'Played',      val: s.played },
      { label: 'Won',         val: s.won },
      { label: 'Win Rate',    val: `${winRate}%` },
      { label: 'Best Streak', val: `${s.bestStreak} 🔥` },
      { label: 'Avg Time',    val: avgTime ? fmtTime(avgTime) : '—' },
      { label: 'Mistakes',    val: s.totalMistakes },
    ].map(({ label, val }) => `
      <div class="stat-tile">
        <div class="tile-label">${label}</div>
        <div class="tile-value">${val}</div>
      </div>
    `).join('');

    $('best-times-grid').innerHTML = ['easy','medium','hard','expert'].map(d => `
      <div class="best-time-row">
        <span class="diff-name">${d}</span>
        <span class="diff-time">${s.bestTimes[d] !== null ? fmtTime(s.bestTimes[d]) : '—'}</span>
      </div>
    `).join('');

    this._showModal('stats-modal');
  }

  showConfirm()   { this._showModal('confirm-modal'); }
  hideConfirm()   { this._hideModal('confirm-modal'); }
  hideAllModals() {
    ['win-modal','gameover-modal','stats-modal','confirm-modal'].forEach(id => this._hideModal(id));
  }

  /* ── Helpers ── */

  /** Return all cell keys in the same row, col, and box as (r, c). */
  _related(r, c) {
    const keys = new Set();
    for (let i = 0; i < 9; i++) {
      keys.add(`${r},${i}`);
      keys.add(`${i},${c}`);
    }
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++)
        keys.add(`${br + dr},${bc + dc}`);
    return keys;
  }

  /** Return [r,c] pairs of all cells related to (r,c) including itself. */
  relatedCoords(r, c) {
    return [...this._related(r, c)].map(k => k.split(',').map(Number));
  }
}

/* ══════════════════════════════════════════════════════════════
   6. CONFETTI — canvas particle burst on win
══════════════════════════════════════════════════════════════ */

const Confetti = (() => {
  const canvas = $('confetti-canvas');
  const ctx    = canvas.getContext('2d');
  let particles = [];
  let raf = null;
  const COLORS = ['#c8963c','#e8c880','#2a5ca8','#6eb0f8','#c03030','#6ab870'];

  function launch() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    particles = Array.from({ length: 110 }, () => ({
      x:    Math.random() * canvas.width,
      y:    -20 - Math.random() * canvas.height * 0.3,
      vx:   (Math.random() - 0.5) * 4,
      vy:   Math.random() * 3.5 + 1.5,
      rot:  Math.random() * 360,
      rotV: (Math.random() - 0.5) * 7,
      w:    Math.random() * 9 + 4,
      h:    Math.random() * 4 + 2,
      col:  COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: 1,
    }));
    if (raf) cancelAnimationFrame(raf);
    _step();
  }

  function _step() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.x   += p.vx;
      p.y   += p.vy;
      p.rot += p.rotV;
      if (p.y > canvas.height * 0.65) p.alpha -= 0.025;
      if (p.alpha > 0) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.col;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
    }
    if (alive) raf = requestAnimationFrame(_step);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { launch };
})();

/* ══════════════════════════════════════════════════════════════
   7. CONTROLLER — wires everything together
══════════════════════════════════════════════════════════════ */

const state    = new GameState();
const renderer = new Renderer(state);

/* ── Timer ── */
let timerInterval = null;

function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    state.tickTimer();
    renderer.updateTimer();
  }, 1000);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

/* Pause timer when the browser tab is hidden (Visibility API) */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopTimer();
  else if (!state.over) startTimer();
});

/* ── Game lifecycle ── */

function doNewGame() {
  stopTimer();
  renderer.hideAllModals();
  renderer.clearMsg();

  const diff    = $('difficulty').value;
  const sol     = generateSolution();
  const puzzle  = carvePuzzle(sol, REMOVALS_BY_DIFF[diff] ?? 44);

  state.startGame({ puzzle, solution: sol, diff });
  renderer.paintAll();
  startTimer();
}

/** Ask for confirmation if a game is in progress. */
function confirmNewGame() {
  if (!state.puzzle || state.over) { doNewGame(); return; }
  renderer.showConfirm();
}

/** Reset current puzzle to its original state. */
function doReset() {
  if (!state.puzzle) return;
  // Rebuild game state with the same puzzle and solution
  state.startGame({
    puzzle:   state.given.map(r => [...r]),
    solution: state.solution,
    diff:     state.diff,
  });
  renderer.paintAll();
  startTimer();
  renderer.clearMsg();
}

function restoreGame() {
  if (!state.restore()) return false;
  $('difficulty').value = state.diff;
  renderer.paintAll();
  if (!state.over) startTimer();
  return true;
}

/* ── Input handlers ── */

function onCellClick(r, c) {
  if (state.over) return;
  const prev = state.selected ? [...state.selected] : null;
  state.setSelected(r, c);
  renderer.updateSelection(prev);
  Audio.select();
}

function onDigit(num) {
  if (state.over) return;
  const result = state.enterDigit(num);

  switch (result.type) {
    case 'noop':
    case 'given':
      return;

    case 'note':
      renderer.paintCells([[result.r, result.c]]);
      Audio.note();
      break;

    case 'erase':
      renderer.paintCells([[result.r, result.c]]);
      renderer.updateHUDFull();
      Audio.erase();
      break;

    case 'correct': {
      // Repaint the whole related group so same-digit highlights update
      const coords = renderer.relatedCoords(result.r, result.c);
      renderer.paintCells(coords);
      renderer.popCell(result.r, result.c);
      renderer.updateHUDFull();
      Audio.correct();
      if (navigator.vibrate) navigator.vibrate(25);

      // Flash completed row / column / box
      checkGroupCompletion(result.r, result.c);

      if (state.isSolved()) {
        handleWin();
      }
      break;
    }

    case 'wrong': {
      renderer.paintCells([[result.r, result.c]]);
      renderer.shakeCell(result.r, result.c);
      renderer.loseLife(state.lives); // state.lives is AFTER decrement
      renderer.updateHUDFull();
      Audio.wrong();
      if (navigator.vibrate) navigator.vibrate([50, 30, 50]);

      if (result.fatal) {
        handleGameOver();
      } else {
        renderer.setMsg(
          `Incorrect — ${state.lives} ${state.lives === 1 ? 'life' : 'lives'} remaining`,
          'error', 2500
        );
      }
      break;
    }
  }
}

function onErase() {
  if (!state.selected || state.over) return;
  const [r, c] = state.selected;
  if (state.erase()) {
    renderer.paintCells([[r, c]]);
    renderer.updateHUDFull();
    Audio.erase();
  }
}

function onUndo() {
  const cell = state.undo();
  if (!cell) return;
  const coords = renderer.relatedCoords(cell.r, cell.c);
  renderer.paintCells(coords);
  renderer.updateHUDFull();
  renderer.setMsg('Undone', 'info', 1200);
}

function onHint() {
  if (state.over) return;
  const hint = getSmartHint(state.puzzle, state.solution);
  if (!hint) { renderer.setMsg('Board is already complete!', 'info', 2000); return; }

  state.applyHint(hint.r, hint.c);
  const coords = renderer.relatedCoords(hint.r, hint.c);
  renderer.paintCells(coords);
  renderer.hintCell(hint.r, hint.c);
  renderer.updateHUDFull();
  Audio.hint();

  if (state.isSolved()) handleWin();
}

function onCheck() {
  let errors = 0;
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      if (state.puzzle[r][c] !== 0 && state.given[r][c] === 0 && state.puzzle[r][c] !== state.solution[r][c])
        errors++;

  if (errors === 0) renderer.setMsg('No errors found — looking great ✓', 'ok', 3000);
  else              renderer.setMsg(`${errors} error${errors > 1 ? 's' : ''} found on the board`, 'error', 3000);
}

function toggleNotes() {
  state.toggleNoteMode();
  renderer._updateNoteBtn();
}

/* ── Win / Game Over ── */

function handleWin() {
  stopTimer();
  const isRecord = !state.loadStats().bestTimes[state.diff] ||
                   state.seconds < state.loadStats().bestTimes[state.diff];
  state.endGame();
  Confetti.launch();
  Audio.win();
  setTimeout(() => renderer.showWin(isRecord), 600);
}

function handleGameOver() {
  stopTimer();
  state.endGame();
  state.recordLoss();
  setTimeout(() => renderer.showGameover(), 400);
}

/* ── Group completion detection (flash row/col/box) ── */

function checkGroupCompletion(r, c) {
  const p = state.puzzle;
  const sol = state.solution;

  // Check row
  if ([0,1,2,3,4,5,6,7,8].every(col => p[r][col] === sol[r][col]))
    renderer.flashCells([0,1,2,3,4,5,6,7,8].map(col => [r, col]));

  // Check column
  if ([0,1,2,3,4,5,6,7,8].every(row => p[row][c] === sol[row][c]))
    renderer.flashCells([0,1,2,3,4,5,6,7,8].map(row => [row, c]));

  // Check 3×3 box
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  const boxCells = [];
  for (let dr = 0; dr < 3; dr++)
    for (let dc = 0; dc < 3; dc++)
      boxCells.push([br + dr, bc + dc]);
  if (boxCells.every(([row, col]) => p[row][col] === sol[row][col]))
    renderer.flashCells(boxCells);
}

/* ── Keyboard ── */

document.addEventListener('keydown', e => {
  // Don't hijack when typing in native inputs/selects
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

  // Digits 1–9
  if (e.key >= '1' && e.key <= '9') { onDigit(+e.key); return; }

  // Erase
  if (e.key === 'Backspace' || e.key === 'Delete') { onErase(); return; }

  // Notes toggle
  if (e.key === 'n' || e.key === 'N') { toggleNotes(); return; }

  // Undo
  if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) { onUndo(); return; }

  // Close modals
  if (e.key === 'Escape') { renderer.hideAllModals(); return; }

  // Arrow navigation
  const dirs = { ArrowUp: [-1,0], ArrowDown: [1,0], ArrowLeft: [0,-1], ArrowRight: [0,1] };
  if (dirs[e.key] && !state.over) {
    e.preventDefault(); // prevent page scroll
    const prev = state.selected ? [...state.selected] : null;
    if (!state.selected) { state.setSelected(0, 0); }
    else { const [dr, dc] = dirs[e.key]; state.moveSelected(dr, dc); }
    renderer.updateSelection(prev);
    const [nr, nc] = state.selected;
    renderer.setTabFocus(nr, nc);
  }
});

/* ── Theme toggle ── */

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.savePref('theme', theme);
}

$('btn-theme').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

/* ── Stats ── */

$('btn-stats-open').addEventListener('click', () => renderer.showStats());
$('btn-stats-close').addEventListener('click', () => renderer._hideModal('stats-modal'));

/* ── Button wiring ── */

renderer.buildBoard(onCellClick);
renderer.buildNumpad(onDigit);

$('btn-new').addEventListener('click',    confirmNewGame);
$('btn-reset').addEventListener('click',  doReset);
$('btn-note').addEventListener('click',   toggleNotes);
$('btn-hint').addEventListener('click',   onHint);
$('btn-undo').addEventListener('click',   onUndo);
$('btn-check').addEventListener('click',  onCheck);

$('btn-win-new').addEventListener('click',   doNewGame);
$('btn-win-close').addEventListener('click', () => renderer._hideModal('win-modal'));
$('btn-go-new').addEventListener('click',    doNewGame);

$('btn-confirm-yes').addEventListener('click', doNewGame);
$('btn-confirm-no').addEventListener('click',  () => renderer.hideConfirm());

$('difficulty').addEventListener('change', confirmNewGame);

/* ── Close modals on backdrop click ── */
['win-modal','gameover-modal','stats-modal','confirm-modal'].forEach(id => {
  $(id).addEventListener('click', e => {
    if (e.target === $(id)) renderer._hideModal(id);
  });
});

/* ── Apply saved preferences ── */
(function applyPrefs() {
  const prefs = state.loadPrefs();
  if (prefs.theme) setTheme(prefs.theme);
})();

/* ── Boot ── */
if (!restoreGame()) {
  doNewGame();
}
