// ガイドの頭脳：局面を見て、初心者向けのことばで注意やヒントを作る。
// 画面には触らない純粋な関数だけを置く（node でテストできるように）。
(function () {
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const NAME = { p: 'ポーン', n: 'ナイト', b: 'ビショップ', r: 'ルーク', q: 'クイーン', k: 'キング' };
  const COLOR = { w: '白', b: '黒' };
  const HOW_IT_MOVES = {
    p: 'まっすぐ前に1マス（最初の1回だけ2マスもOK）。相手の駒を取るときだけ、ななめ前に進むよ。',
    n: 'L字にジャンプ。ほかの駒を飛び越えられるのはナイトだけ。',
    b: 'ななめに好きなだけ進める。ずっと同じ色のマスを動くよ。',
    r: 'たて・よこに好きなだけ進める。',
    q: 'たて・よこ・ななめ、どこまでも。いちばん強い駒だから、取られないように気をつけて。',
    k: 'まわりに1マスずつ。キングが逃げられなくなったら負け（チェックメイト）。',
  };

  function opposite(color) {
    return color === 'w' ? 'b' : 'w';
  }

  function allSquares() {
    const out = [];
    for (const r of '87654321') for (const f of 'abcdefgh') out.push(f + r);
    return out;
  }
  const SQUARES = allSquares();

  // color 側の駒のうち、ただで（または損な交換で）取られそうなものを返す。
  // 正確な読みではなく「相手のいちばん安い駒で取られたら、いくら損するか」のざっくり計算。
  function hangingPieces(chess, color) {
    const enemy = opposite(color);
    const out = [];
    for (const sq of SQUARES) {
      const pc = chess.get(sq);
      if (!pc || pc.color !== color || pc.type === 'k') continue;
      const attackers = chess.attackers(sq, enemy);
      if (attackers.length === 0) continue;
      const defended = chess.attackers(sq, color).length > 0;
      const cheapest = Math.min(...attackers.map((a) => VALUE[chess.get(a).type]));
      if (defended && cheapest === VALUE.k) continue; // 守られている駒はキングでは取れない
      const loss = defended ? VALUE[pc.type] - cheapest : VALUE[pc.type];
      if (loss >= 1) out.push({ square: sq, piece: pc.type, loss, attackers });
    }
    return out.sort((a, b) => b.loss - a.loss);
  }

  // 相手が次の1手でチェックメイトできるなら、その手を返す
  function mateThreat(chess) {
    for (const m of chess.moves({ verbose: true })) {
      chess.move(m);
      const mate = chess.isCheckmate();
      chess.undo();
      if (mate) return m;
    }
    return null;
  }

  // 指す前の「ちょっと待って！」判定。問題がなければ null。
  function checkMove(chess, move) {
    const me = chess.turn();
    const played = chess.move(move);
    try {
      if (chess.isCheckmate()) return null;
      const mate = mateThreat(chess);
      if (mate) {
        return {
          kind: 'mate',
          text: `その手だと、相手の${NAME[mate.piece]}が ${mate.to} に来てチェックメイトされちゃう！`,
          squares: [mate.from, mate.to],
        };
      }
      const gained = played.captured ? VALUE[played.captured] : 0;
      const worst = hangingPieces(chess, me)[0];
      if (worst && worst.loss - gained >= 2) {
        const own = worst.square === played.to ? `動かした${NAME[worst.piece]}` : `${worst.square} の${NAME[worst.piece]}`;
        return {
          kind: 'hang',
          piece: worst.piece,
          text: `その手だと、${own}が相手の${NAME[chess.get(worst.attackers[0]).type]}に取られちゃうかも。`,
          squares: [worst.square, ...worst.attackers],
        };
      }
      return null;
    } finally {
      chess.undo();
    }
  }

  function describeSquareMove(m) {
    return `${NAME[m.piece]}を ${m.to} へ`;
  }

  // 指された手をふつうの日本語で
  function describeMove(m) {
    if (m.isKingsideCastle()) return 'キャスリング（キングを右側の安全な場所へ移して、ルークを出した）';
    if (m.isQueensideCastle()) return 'キャスリング（キングを左側の安全な場所へ移して、ルークを出した）';
    let text = `${NAME[m.piece]}を ${m.from} から ${m.to} へ`;
    if (m.captured) text = `${NAME[m.piece]}で ${m.to} の${NAME[m.captured]}を取った`;
    if (m.isEnPassant()) text += '（アンパッサン：ポーンの特別な取り方）';
    if (m.promotion) text += `。ポーンが${NAME[m.promotion]}に成った！`;
    return text;
  }

  // 自分の手番が来たときに伝えること
  function turnAdvice(chess) {
    const me = chess.turn();
    if (chess.inCheck()) {
      return {
        kind: 'check',
        text: 'チェック！キングがねらわれてる。「キングを逃がす」「間に駒をはさむ」「ねらってる駒を取る」のどれかで守ろう。',
        squares: [],
      };
    }
    const mate = (() => {
      // 相手がもう一度指せたら詰ませられるか（＝今ねらわれている詰み）
      const fen = chess.fen().split(' ');
      fen[1] = opposite(me);
      fen[3] = '-';
      try {
        const probe = new window.ChessLib.Chess(fen.join(' '));
        return mateThreat(probe);
      } catch (e) {
        return null;
      }
    })();
    if (mate) {
      return {
        kind: 'mate-threat',
        text: `あぶない！相手は${NAME[mate.piece]}を ${mate.to} に動かして、チェックメイトしようとねらってるよ。`,
        squares: [mate.from, mate.to],
      };
    }
    const hanging = hangingPieces(chess, me).filter((h) => h.loss >= 2);
    if (hanging.length) {
      const h = hanging[0];
      return {
        kind: 'hanging',
        text: `${h.square} の${NAME[h.piece]}がねらわれてるよ。逃がすか、守ってあげよう。`,
        squares: hanging.map((x) => x.square),
      };
    }
    return null;
  }

  // ヒント：AIで良い手を探して、なぜ良いのかをひとこと添える
  function hint(chess) {
    const scored = window.KasumiAI.scoreMoves(chess, { depth: 2, quiesce: true });
    if (!scored.length) return null;
    const m = scored[0].move;
    const me = chess.turn();
    let reason;
    chess.move(m);
    const mate = chess.isCheckmate();
    const check = chess.inCheck();
    chess.undo();
    const hangingBefore = hangingPieces(chess, me).filter((h) => h.loss >= 2);
    if (mate) reason = 'これでチェックメイト！';
    else if (m.captured && VALUE[m.captured] >= 3) reason = `相手の${NAME[m.captured]}を取れるよ。`;
    else if (hangingBefore.some((h) => h.square === m.from)) reason = `ねらわれている${NAME[m.piece]}を安全な場所へ逃がそう。`;
    else if (m.captured) reason = `相手の${NAME[m.captured]}を取れるよ。`;
    else if (check) reason = 'チェックをかけて、相手のキングを追いかけよう。';
    else if (m.isKingsideCastle() || m.isQueensideCastle()) reason = 'キャスリングでキングを安全な場所へ。';
    else if ((m.piece === 'n' || m.piece === 'b') && (m.from[1] === '1' || m.from[1] === '8'))
      reason = 'まだ動いていない駒を外に出して、戦いに参加させよう。';
    else if (m.piece === 'p' && 'de'.includes(m.from[0])) reason = '真ん中のポーンを進めて、場所を取ろう。';
    else reason = 'いまの局面では、この手がよさそう。';
    return { move: m, text: `${describeSquareMove(m)}（${m.from} → ${m.to}）。${reason}` };
  }

  // パズルで違う手を指したときに「なぜダメか」を説明する（m は指した直後の局面で呼ぶ）
  function whyNotMate(chess) {
    if (!chess.inCheck()) return 'それだとチェックになってないよ。まずは相手のキングをねらう手を探そう。';
    const replies = chess.moves({ verbose: true });
    const kingRun = replies.find((r) => r.piece === 'k' && !r.captured);
    if (kingRun) return `チェックはかかったけど、キングが ${kingRun.to} に逃げられちゃう。`;
    const capture = replies.find((r) => r.captured);
    if (capture) return `チェックはかかったけど、${NAME[capture.piece]}で取られちゃう。`;
    return 'チェックはかかったけど、間に駒をはさんで守られちゃう。';
  }

  window.KasumiGuide = {
    VALUE,
    NAME,
    COLOR,
    HOW_IT_MOVES,
    hangingPieces,
    checkMove,
    describeMove,
    turnAdvice,
    hint,
    whyNotMate,
  };
})();
