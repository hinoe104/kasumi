// 画面まわり：盤の描画、クリック操作、対局と1手詰めの進行、対局記録の保存。
(function () {
  const { Chess } = window.ChessLib;
  const AI = window.KasumiAI;
  const G = window.KasumiGuide;
  const PUZZLES = window.KasumiPuzzles;

  const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const LEVEL_NAME = { hiyoko: 'ひよこ', usagi: 'うさぎ', kitsune: 'きつね' };
  const STORE = {
    games: 'kasumi-chess-games-v1',
    current: 'kasumi-chess-current-v1',
    solved: 'kasumi-chess-solved-v1',
    guide: 'kasumi-chess-guide-v1',
  };

  // localStorage はプライベートモード等で使えないことがあるので、失敗しても動くようにする
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 保存できなくても遊べる */
    }
  }

  const $ = (sel) => document.querySelector(sel);

  const state = {
    mode: 'game', // 'game' | 'puzzle' | 'records'
    chess: new Chess(),
    playerColor: 'w',
    level: 'hiyoko',
    guideOn: load(STORE.guide, true),
    selected: null,
    pending: null, // 警告中の手 { move, warning }
    hintMove: null,
    marks: [], // ガイドが注意をうながしているマス
    thinking: false,
    over: false,
    // 対局の記録（あとでAI分析に使う）
    events: [],
    undos: 0,
    hints: 0,
    startedAt: null,
    // パズル
    puzzleIndex: 0,
    puzzleTries: 0,
    puzzleSolved: false,
    solved: new Set(load(STORE.solved, [])),
  };

  // ---------- 盤 ----------
  const boardEl = $('#board');
  const squareEls = {};
  for (let i = 0; i < 64; i++) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'sq';
    el.addEventListener('click', () => onSquare(el.dataset.square));
    boardEl.appendChild(el);
  }

  function orientation() {
    return state.mode === 'puzzle' ? PUZZLE_COLOR() : state.playerColor;
  }
  function PUZZLE_COLOR() {
    return new Chess(PUZZLES[state.puzzleIndex].fen).turn();
  }

  function renderBoard() {
    const flip = orientation() === 'b';
    const ranks = flip ? '12345678' : '87654321';
    const files = flip ? 'hgfedcba' : 'abcdefgh';
    const c = state.chess;
    const legal = state.selected ? c.moves({ square: state.selected, verbose: true }) : [];
    const last = c.history({ verbose: true }).slice(-1)[0];
    const kingInCheck = c.inCheck()
      ? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
          .flatMap((f) => '12345678'.split('').map((r) => f + r))
          .find((sq) => {
            const p = c.get(sq);
            return p && p.type === 'k' && p.color === c.turn();
          })
      : null;

    let i = 0;
    for (const r of ranks) {
      for (const f of files) {
        const sq = f + r;
        const el = boardEl.children[i++];
        squareEls[sq] = el;
        el.dataset.square = sq;
        const pc = c.get(sq);
        const dark = (f.charCodeAt(0) - 97 + Number(r)) % 2 === 1;
        const target = legal.find((m) => m.to === sq);
        const cls = ['sq', dark ? 'dark' : 'light'];
        if (sq === state.selected) cls.push('selected');
        if (last && (last.from === sq || last.to === sq)) cls.push('last');
        if (target) cls.push(target.captured ? 'capture' : 'move');
        if (sq === kingInCheck) cls.push('check');
        if (state.guideOn && state.marks.includes(sq)) cls.push('warn');
        if (state.hintMove && (state.hintMove.from === sq || state.hintMove.to === sq)) cls.push('hint');
        el.className = cls.join(' ');
        el.innerHTML =
          (pc ? `<span class="pc ${pc.color}">${GLYPH[pc.type]}︎</span>` : '') +
          (f === files[0] ? `<span class="coord rank">${r}</span>` : '') +
          (r === ranks[7] ? `<span class="coord file">${f}</span>` : '');
        el.setAttribute(
          'aria-label',
          sq + (pc ? ` ${G.COLOR[pc.color]}の${G.NAME[pc.type]}` : '') + (target ? '（ここに動ける）' : '')
        );
      }
    }
  }

  // ---------- ガイドの吹き出し ----------
  function say(html, tone = 'info') {
    const el = $('#guide-text');
    el.innerHTML = html;
    $('#guide').dataset.tone = tone;
  }
  function setActions(buttons) {
    const box = $('#guide-actions');
    box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = b.primary ? 'btn primary' : 'btn';
      el.textContent = b.label;
      el.addEventListener('click', b.onClick);
      box.appendChild(el);
    }
  }

  // ---------- 操作 ----------
  function myTurn() {
    if (state.mode === 'puzzle') return !state.puzzleSolved && !state.thinking;
    return !state.over && !state.thinking && state.chess.turn() === state.playerColor;
  }

  function onSquare(sq) {
    if (!myTurn() || state.pending) return;
    const c = state.chess;
    const pc = c.get(sq);
    if (state.selected) {
      const move = c
        .moves({ square: state.selected, verbose: true })
        .find((m) => m.to === sq && (!m.promotion || m.promotion === 'q'));
      if (move) return tryMove(move);
    }
    if (pc && pc.color === c.turn()) {
      state.selected = sq === state.selected ? null : sq;
      if (state.selected) {
        const n = c.moves({ square: sq }).length;
        say(
          `<b>${G.NAME[pc.type]}</b>：${G.HOW_IT_MOVES[pc.type]}` +
            (n ? `<br><span class="sub">光っているマスに動かせるよ。</span>` : `<br><span class="sub">この駒は今は動かせないみたい。</span>`)
        );
      }
    } else {
      state.selected = null;
    }
    renderBoard();
  }

  function tryMove(move) {
    state.selected = null;
    state.hintMove = null;
    if (state.mode === 'puzzle') return puzzleMove(move);
    const warning = state.guideOn ? G.checkMove(state.chess, move) : null;
    if (warning) {
      state.pending = { move, warning };
      state.marks = warning.squares;
      renderBoard();
      say(`<b>ちょっと待って！</b><br>${warning.text}`, 'warn');
      setActions([
        {
          label: 'やっぱりやめる',
          primary: true,
          onClick: () => {
            state.events.push({ type: 'warning-heeded', ply: state.chess.history().length, kind: warning.kind, piece: warning.piece || null, san: move.san });
            state.pending = null;
            state.marks = [];
            renderBoard();
            say('うん、ほかの手を探してみよう。');
            gameActions();
          },
        },
        {
          label: 'それでも動かす',
          onClick: () => {
            state.events.push({ type: 'warning-ignored', ply: state.chess.history().length, kind: warning.kind, piece: warning.piece || null, san: move.san });
            state.pending = null;
            state.marks = [];
            playerMove(move);
          },
        },
      ]);
      return;
    }
    playerMove(move);
  }

  // ---------- 対局 ----------
  function newGame() {
    state.mode = 'game';
    state.chess = new Chess();
    state.chess.setHeader('Event', 'はじめてのチェス');
    state.chess.setHeader('Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'));
    state.chess.setHeader('White', state.playerColor === 'w' ? 'あなた' : `AI（${LEVEL_NAME[state.level]}）`);
    state.chess.setHeader('Black', state.playerColor === 'b' ? 'あなた' : `AI（${LEVEL_NAME[state.level]}）`);
    Object.assign(state, {
      selected: null, pending: null, hintMove: null, marks: [], over: false, thinking: false,
      events: [], undos: 0, hints: 0, startedAt: new Date().toISOString(),
    });
    showPanel('game');
    renderBoard();
    if (state.playerColor === 'b') {
      say('あなたは黒。白（AI）が先に指すよ。');
      aiTurn();
    } else {
      say('あなたは白だから先手だよ。動かしたい駒をタップしてね。<br><span class="sub">迷ったら、真ん中のポーン（e2 や d2）を2マス進めるのが定番。</span>');
      gameActions();
    }
    persistCurrent();
  }

  function playerMove(move) {
    const played = state.chess.move(move);
    afterMove(played, 'player');
  }

  function afterMove(played, by) {
    state.marks = [];
    renderBoard();
    persistCurrent();
    if (finishIfOver(by)) return;
    if (by === 'player') {
      const promo = played.promotion ? '<br>ポーンがいちばん奥まで進んだから、クイーンに成ったよ！' : '';
      say(`${G.describeMove(played)}。${promo}<br><span class="sub">AI が考え中…</span>`);
      aiTurn();
    } else {
      onPlayerTurn(played);
    }
  }

  function aiTurn() {
    state.thinking = true;
    setActions([]);
    // 少し間をおいて、指した手が見えてから考え始める
    setTimeout(() => {
      const m = AI.bestMove(state.chess, state.level);
      setTimeout(() => {
        state.thinking = false;
        const played = state.chess.move(m);
        afterMove(played, 'ai');
      }, 250);
    }, 350);
  }

  function onPlayerTurn(aiMove, intro = '') {
    let text = intro + (aiMove ? `AI は${G.describeMove(aiMove)}。` : '');
    let tone = 'info';
    if (state.guideOn) {
      const advice = G.turnAdvice(state.chess);
      if (advice) {
        text += `<br><b>${advice.text}</b>`;
        state.marks = advice.squares;
        tone = 'warn';
      } else {
        text += '<br><span class="sub">あなたの番だよ。</span>';
      }
    } else {
      text += '<br><span class="sub">あなたの番だよ。</span>';
    }
    renderBoard();
    say(text, tone);
    gameActions();
  }

  function gameActions() {
    const buttons = [{ label: 'ヒント', onClick: showHint }];
    if (state.chess.history().length >= (state.playerColor === 'w' ? 2 : 3)) {
      buttons.push({ label: '1手もどす', onClick: undoMove });
    }
    buttons.push({ label: '投了する', onClick: confirmResign });
    setActions(buttons);
  }

  function showHint() {
    if (!myTurn()) return;
    const h = G.hint(state.chess);
    if (!h) return;
    state.hints++;
    state.events.push({ type: 'hint', ply: state.chess.history().length, san: h.move.san });
    state.hintMove = h.move;
    state.selected = null;
    renderBoard();
    say(`<b>ヒント</b>：${h.text}`, 'hint');
    persistCurrent();
  }

  function undoMove() {
    if (!myTurn()) return;
    const c = state.chess;
    // AIの手と自分の手の2つをもどす
    c.undo();
    c.undo();
    state.undos++;
    const ply = c.history().length;
    state.events = state.events.filter((e) => e.ply < ply || e.type === 'undo');
    state.events.push({ type: 'undo', ply });
    state.hintMove = null;
    state.marks = [];
    renderBoard();
    say('1手もどしたよ。もう一度考えてみよう。');
    gameActions();
    persistCurrent();
  }

  function confirmResign() {
    say('投了すると、この対局はあなたの負けで終わるよ。いい？', 'warn');
    setActions([
      { label: '続ける', primary: true, onClick: () => onPlayerTurn(null) },
      { label: '投了する', onClick: () => endGame('loss', '投了') },
    ]);
  }

  function finishIfOver(lastBy) {
    const c = state.chess;
    if (!c.isGameOver()) return false;
    if (c.isCheckmate()) {
      endGame(lastBy === 'player' ? 'win' : 'loss', 'チェックメイト');
    } else if (c.isStalemate()) {
      endGame('draw', 'ステイルメイト');
    } else if (c.isThreefoldRepetition()) {
      endGame('draw', '同じ局面の3回くり返し');
    } else if (c.isInsufficientMaterial()) {
      endGame('draw', 'お互い詰ませる駒が足りない');
    } else {
      endGame('draw', '50手ルール');
    }
    return true;
  }

  function endGame(result, reason) {
    state.over = true;
    state.pending = null;
    state.hintMove = null;
    const c = state.chess;
    c.setHeader('Result', result === 'draw' ? '1/2-1/2' : (result === 'win') === (state.playerColor === 'w') ? '1-0' : '0-1');
    renderBoard();
    const msg = {
      win: `<b>チェックメイト！あなたの勝ち！</b><br>おめでとう 🎉`,
      loss: reason === '投了' ? '<b>投了したよ。</b><br>おつかれさま。次はきっともっとうまくいく。' : '<b>チェックメイトされちゃった…</b><br>でも、負けた対局こそいちばんの先生。',
      draw:
        reason === 'ステイルメイト'
          ? '<b>ステイルメイトで引き分け。</b><br>手番の側が、チェックされてないのに動かせる手がない状態のこと。勝っているときは、相手のキングに逃げ道を1つ残してあげるのがコツだよ。'
          : `<b>引き分け（${reason}）。</b>`,
    }[result];
    say(msg + '<br><span class="sub">この対局は「記録」に保存したよ。</span>', result === 'win' ? 'good' : 'info');
    setActions([{ label: 'もう一局', primary: true, onClick: newGame }]);
    const games = load(STORE.games, []);
    games.unshift({
      id: Date.now().toString(36),
      startedAt: state.startedAt,
      endedAt: new Date().toISOString(),
      playerColor: state.playerColor,
      level: state.level,
      guideOn: state.guideOn,
      result,
      reason,
      pgn: c.pgn(),
      moves: c.history().length,
      undos: state.undos,
      hints: state.hints,
      events: state.events,
    });
    save(STORE.games, games);
    save(STORE.current, null);
  }

  // 途中で閉じても続きから遊べるように
  function persistCurrent() {
    if (state.mode !== 'game' || state.over) return;
    save(STORE.current, {
      pgn: state.chess.pgn(),
      playerColor: state.playerColor,
      level: state.level,
      events: state.events,
      undos: state.undos,
      hints: state.hints,
      startedAt: state.startedAt,
    });
  }

  function resumeGame(saved) {
    const c = new Chess();
    try {
      c.loadPgn(saved.pgn);
    } catch (e) {
      return false;
    }
    Object.assign(state, {
      mode: 'game', chess: c, playerColor: saved.playerColor, level: saved.level,
      events: saved.events || [], undos: saved.undos || 0, hints: saved.hints || 0,
      startedAt: saved.startedAt, over: false, thinking: false, selected: null, pending: null, hintMove: null, marks: [],
    });
    syncSetupControls();
    showPanel('game');
    renderBoard();
    if (c.turn() === state.playerColor) {
      onPlayerTurn(null, '前回の対局の続きからだよ。');
    } else {
      say('前回の対局の続きからだよ。<br><span class="sub">AI が考え中…</span>');
      aiTurn();
    }
    return true;
  }

  // ---------- 1手詰め ----------
  function openPuzzle(i) {
    state.mode = 'puzzle';
    state.puzzleIndex = (i + PUZZLES.length) % PUZZLES.length;
    const p = PUZZLES[state.puzzleIndex];
    Object.assign(state, {
      chess: new Chess(p.fen), selected: null, pending: null, hintMove: null, marks: [],
      puzzleTries: 0, puzzleSolved: false, over: false, thinking: false,
    });
    showPanel('puzzle');
    renderPuzzleList();
    renderBoard();
    const side = state.chess.turn() === 'w' ? '白' : '黒';
    say(`<b>第${state.puzzleIndex + 1}問「${p.title}」</b><br>あなたは${side}。1手でチェックメイトしよう！`);
    puzzleActions();
  }

  function puzzleActions() {
    const buttons = [];
    if (!state.puzzleSolved) buttons.push({ label: 'ヒント', onClick: puzzleHint });
    buttons.push({ label: state.puzzleSolved ? '次の問題へ' : 'とばす', primary: state.puzzleSolved, onClick: () => openPuzzle(state.puzzleIndex + 1) });
    setActions(buttons);
  }

  function puzzleHint() {
    const p = PUZZLES[state.puzzleIndex];
    state.puzzleTries++;
    if (state.puzzleTries >= 2) {
      // 2回目のヒントでは動かす駒まで教える
      const mate = state.chess.moves({ verbose: true }).find((m) => {
        state.chess.move(m);
        const ok = state.chess.isCheckmate();
        state.chess.undo();
        return ok;
      });
      state.hintMove = { from: mate.from, to: null };
      renderBoard();
      say(`<b>ヒント</b>：${p.hint}<br>動かすのは光っている<b>${G.NAME[mate.piece]}</b>だよ。`, 'hint');
    } else {
      say(`<b>ヒント</b>：${p.hint}`, 'hint');
    }
  }

  function puzzleMove(move) {
    const c = state.chess;
    const played = c.move(move);
    renderBoard();
    if (c.isCheckmate()) {
      state.puzzleSolved = true;
      state.solved.add(state.puzzleIndex);
      save(STORE.solved, [...state.solved]);
      renderPuzzleList();
      say(`<b>正解！チェックメイト！</b><br>${PUZZLES[state.puzzleIndex].lesson}`, 'good');
      puzzleActions();
      return;
    }
    const why = G.whyNotMate(c);
    say(`<b>おしい！</b>${G.describeMove(played)}だと…<br>${why}`, 'warn');
    state.thinking = true;
    setTimeout(() => {
      state.thinking = false;
      c.undo();
      renderBoard();
    }, 900);
    state.puzzleTries++;
  }

  function renderPuzzleList() {
    const box = $('#puzzle-list');
    box.innerHTML = '';
    PUZZLES.forEach((p, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (i === state.puzzleIndex ? ' current' : '') + (state.solved.has(i) ? ' solved' : '');
      b.textContent = `${i + 1}`;
      b.title = p.title;
      b.setAttribute('aria-label', `第${i + 1}問 ${p.title}${state.solved.has(i) ? '（クリア）' : ''}`);
      b.addEventListener('click', () => openPuzzle(i));
      box.appendChild(b);
    });
    $('#puzzle-progress').textContent = `${state.solved.size} / ${PUZZLES.length} 問クリア`;
  }

  // ---------- 記録 ----------
  function renderRecords() {
    const games = load(STORE.games, []);
    const box = $('#records-list');
    const wins = games.filter((g) => g.result === 'win').length;
    $('#records-summary').textContent = games.length
      ? `${games.length} 局（${wins} 勝）。対局がたまったら、次のステップで AI に分析してもらえるようになるよ。`
      : 'まだ対局の記録はないよ。AI と1局指してみよう。';
    box.innerHTML = '';
    for (const g of games) {
      const ignored = g.events.filter((e) => e.type === 'warning-ignored').length;
      const heeded = g.events.filter((e) => e.type === 'warning-heeded').length;
      const li = document.createElement('li');
      li.className = 'record';
      const label = { win: '勝ち', loss: '負け', draw: '引き分け' }[g.result];
      li.innerHTML = `
        <div class="record-head">
          <span class="result ${g.result}">${label}</span>
          <span>${new Date(g.endedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
          <span class="sub">${g.playerColor === 'w' ? '白' : '黒'} / AI ${LEVEL_NAME[g.level]} / ${g.reason}</span>
        </div>
        <div class="sub">${Math.ceil(g.moves / 2)} 手 ・ ヒント ${g.hints} 回 ・ もどした ${g.undos} 回 ・ 注意を聞いた ${heeded} 回 / スルー ${ignored} 回</div>
        <details><summary>棋譜（PGN）</summary><pre></pre><button type="button" class="btn small">コピー</button></details>`;
      li.querySelector('pre').textContent = g.pgn;
      li.querySelector('details button').addEventListener('click', (ev) => {
        navigator.clipboard?.writeText(g.pgn).then(() => (ev.target.textContent = 'コピーしたよ'));
      });
      box.appendChild(li);
    }
  }

  // ---------- 画面の切りかえ ----------
  function showPanel(mode) {
    for (const tab of document.querySelectorAll('[data-tab]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === mode));
    }
    $('#play-area').hidden = mode === 'records';
    $('#records').hidden = mode !== 'records';
    $('#game-setup').hidden = mode !== 'game';
    $('#puzzle-setup').hidden = mode !== 'puzzle';
  }

  function syncSetupControls() {
    for (const b of document.querySelectorAll('[data-color]')) b.setAttribute('aria-pressed', String(b.dataset.color === state.playerColor));
    for (const b of document.querySelectorAll('[data-level]')) b.setAttribute('aria-pressed', String(b.dataset.level === state.level));
    $('#guide-toggle').checked = state.guideOn;
  }

  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.addEventListener('click', () => {
      const mode = tab.dataset.tab;
      if (mode === 'records') {
        if (state.mode === 'game') persistCurrent();
        state.mode = 'records';
        showPanel('records');
        renderRecords();
      } else if (mode === 'puzzle') {
        if (state.mode === 'game') persistCurrent();
        openPuzzle(state.puzzleIndex);
      } else {
        const saved = load(STORE.current, null);
        if (!(saved && resumeGame(saved))) newGame();
      }
    });
  }
  for (const b of document.querySelectorAll('[data-color]')) {
    b.addEventListener('click', () => {
      state.playerColor = b.dataset.color;
      syncSetupControls();
    });
  }
  for (const b of document.querySelectorAll('[data-level]')) {
    b.addEventListener('click', () => {
      state.level = b.dataset.level;
      syncSetupControls();
    });
  }
  $('#new-game').addEventListener('click', () => {
    if (state.thinking) return;
    if (!state.over && state.chess.history().length > 1) {
      say('いまの対局をやめて、新しく始める？<br><span class="sub">途中の対局は記録に残らないよ。</span>', 'warn');
      setActions([
        { label: '新しく始める', primary: true, onClick: newGame },
        { label: '続ける', onClick: () => onPlayerTurn(null) },
      ]);
      return;
    }
    newGame();
  });
  $('#guide-toggle').addEventListener('change', (e) => {
    state.guideOn = e.target.checked;
    save(STORE.guide, state.guideOn);
    if (!state.guideOn) state.marks = [];
    renderBoard();
  });

  // ---------- はじまり ----------
  syncSetupControls();
  const saved = load(STORE.current, null);
  if (!(saved && resumeGame(saved))) newGame();
})();
