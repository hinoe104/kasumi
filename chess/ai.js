// 対局AI：chess.js の上で動く小さな探索エンジン。
// 初心者向けなので、強さは「読む深さ」と「わざと混ぜる揺らぎ」で調整する。
(function () {
  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  // 駒の位置ボーナス（白から見た a8..h8, a7..h7, ... の順）。黒は上下反転して使う。
  const PST = {
    p: [
      0, 0, 0, 0, 0, 0, 0, 0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
      5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0,
      5, -5, -10, 0, 0, -10, -5, 5,
      5, 10, 10, -20, -20, 10, 10, 5,
      0, 0, 0, 0, 0, 0, 0, 0,
    ],
    n: [
      -50, -40, -30, -30, -30, -30, -40, -50,
      -40, -20, 0, 0, 0, 0, -20, -40,
      -30, 0, 10, 15, 15, 10, 0, -30,
      -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30,
      -30, 5, 10, 15, 15, 10, 5, -30,
      -40, -20, 0, 5, 5, 0, -20, -40,
      -50, -40, -30, -30, -30, -30, -40, -50,
    ],
    b: [
      -20, -10, -10, -10, -10, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 10, 10, 5, 0, -10,
      -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10,
      -10, 10, 10, 10, 10, 10, 10, -10,
      -10, 5, 0, 0, 0, 0, 5, -10,
      -20, -10, -10, -10, -10, -10, -10, -20,
    ],
    r: [
      0, 0, 0, 0, 0, 0, 0, 0,
      5, 10, 10, 10, 10, 10, 10, 5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5,
      0, 0, 0, 5, 5, 0, 0, 0,
    ],
    q: [
      -20, -10, -10, -5, -5, -10, -10, -20,
      -10, 0, 0, 0, 0, 0, 0, -10,
      -10, 0, 5, 5, 5, 5, 0, -10,
      -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5,
      -10, 5, 5, 5, 5, 5, 0, -10,
      -10, 0, 5, 0, 0, 0, 0, -10,
      -20, -10, -10, -5, -5, -10, -10, -20,
    ],
    k: [
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20,
      -10, -20, -20, -20, -20, -20, -20, -10,
      20, 20, 0, 0, 0, 0, 20, 20,
      20, 30, 10, 0, 0, 10, 30, 20,
    ],
  };

  const MATE = 100000;

  const LEVELS = {
    hiyoko: { depth: 1, quiesce: false, noise: 300 },
    usagi: { depth: 2, quiesce: true, noise: 60 },
    kitsune: { depth: 3, quiesce: true, noise: 12 },
  };

  // 探索では chess.js の内部API（_moves/_makeMove/_undoMove, 0x88盤）を直接使う。
  // 公開APIは手ごとにSANを作るので、深く読むと遅すぎるため。
  function algebraic(sq) {
    return 'abcdefgh'[sq & 7] + (8 - (sq >> 4));
  }

  // 白から見た評価値（センチポーン）
  function evaluate(chess) {
    let score = 0;
    const board = chess._board;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const pc = board[sq];
      if (!pc) continue;
      const r = sq >> 4;
      const f = sq & 7;
      const idx = pc.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
      const v = VALUE[pc.type] + PST[pc.type][idx];
      score += pc.color === 'w' ? v : -v;
    }
    return score;
  }

  function orderMoves(moves) {
    return moves
      .map((m) => {
        let key = 0;
        if (m.captured) key += 10 * VALUE[m.captured] - VALUE[m.piece];
        if (m.promotion) key += VALUE[m.promotion];
        return { m, key };
      })
      .sort((a, b) => b.key - a.key)
      .map((x) => x.m);
  }

  function quiesce(chess, alpha, beta, depthLeft) {
    const stand = (chess._turn === 'w' ? 1 : -1) * evaluate(chess);
    if (stand >= beta || depthLeft === 0) return stand;
    if (stand > alpha) alpha = stand;
    const captures = orderMoves(chess._moves({ legal: true }).filter((m) => m.captured));
    for (const m of captures) {
      chess._makeMove(m);
      const score = -quiesce(chess, -beta, -alpha, depthLeft - 1);
      chess._undoMove();
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(chess, depth, alpha, beta, ply, opts) {
    const moves = chess._moves({ legal: true });
    if (moves.length === 0) return chess._isKingAttacked(chess._turn) ? -MATE + ply : 0;
    if (depth === 0) {
      return opts.quiesce
        ? quiesce(chess, alpha, beta, 4)
        : (chess._turn === 'w' ? 1 : -1) * evaluate(chess);
    }
    let best = -Infinity;
    for (const m of orderMoves(moves)) {
      chess._makeMove(m);
      const score = -negamax(chess, depth - 1, -beta, -alpha, ply + 1, opts);
      chess._undoMove();
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  // 手番側から見た合法手のスコア一覧（高い順）。
  // margin を渡すと「最善 − margin」より明らかに悪い手は読みを打ち切る（スコアは上限値になる）。
  function scoreMoves(chess, opts, margin = Infinity) {
    const verbose = chess.moves({ verbose: true });
    const results = [];
    let best = -Infinity;
    for (const m of orderMoves(chess._moves({ legal: true }))) {
      const alpha = best - margin;
      chess._makeMove(m);
      const score = -negamax(chess, opts.depth - 1, -Infinity, -alpha, 1, opts);
      chess._undoMove();
      if (score > best) best = score;
      const from = algebraic(m.from);
      const to = algebraic(m.to);
      const move = verbose.find(
        (v) => v.from === from && v.to === to && (v.promotion || undefined) === (m.promotion || undefined)
      );
      results.push({ move, score });
    }
    return results.sort((a, b) => b.score - a.score);
  }

  function bestMove(chess, levelName) {
    const opts = LEVELS[levelName] || LEVELS.usagi;
    const scored = scoreMoves(chess, opts, opts.noise * 2);
    if (scored.length === 0) return null;
    // 詰みが見えているときは揺らがせずに指す
    if (scored[0].score > MATE / 2) return scored[0].move;
    let pick = null;
    let pickScore = -Infinity;
    for (const s of scored) {
      const noisy = s.score + (Math.random() - 0.5) * 2 * opts.noise;
      if (noisy > pickScore) {
        pickScore = noisy;
        pick = s.move;
      }
    }
    return pick;
  }

  window.KasumiAI = { VALUE, MATE, LEVELS, evaluate, scoreMoves, bestMove };
})();
