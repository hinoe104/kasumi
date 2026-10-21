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

  // 「〜ことができる」につなげる形
  function describeAction(m) {
    if (m.isKingsideCastle() || m.isQueensideCastle()) return 'キャスリングする';
    let text = m.captured ? `${NAME[m.piece]}で ${m.to} の${NAME[m.captured]}を取る` : `${NAME[m.piece]}を ${m.to} へ動かす`;
    if (/#$/.test(m.san)) text += '（チェックメイト）';
    else if (m.promotion) text += `（ポーンが${NAME[m.promotion]}に成る）`;
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

  // その手がなぜ良いのかをひとことで（m は chess の現在局面での合法手）
  function reasonFor(chess, m) {
    const me = chess.turn();
    const hangingBefore = hangingPieces(chess, me).filter((h) => h.loss >= 2);
    chess.move(m);
    const mate = chess.isCheckmate();
    const check = chess.inCheck();
    const forked = forkTargets(chess, m);
    chess.undo();
    if (mate) return 'これでチェックメイト！';
    if (forked.length >= 2) return `両取り（フォーク）！${forked.map((t) => NAME[t]).join('と')}を同時にねらってる。どちらかは取れるよ。`;
    if (m.captured && VALUE[m.captured] >= 3) return `相手の${NAME[m.captured]}を取れるよ。`;
    if (hangingBefore.some((h) => h.square === m.from)) return `ねらわれている${NAME[m.piece]}を安全な場所へ逃がそう。`;
    if (m.captured) return `相手の${NAME[m.captured]}を取れるよ。`;
    if (check) return 'チェックをかけて、相手のキングを追いかけよう。';
    if (m.isKingsideCastle() || m.isQueensideCastle()) return 'キャスリングでキングを安全な場所へ。';
    if ((m.piece === 'n' || m.piece === 'b') && (m.from[1] === '1' || m.from[1] === '8'))
      return 'まだ動いていない駒を外に出して、戦いに参加させよう。';
    if (m.piece === 'p' && 'de'.includes(m.from[0])) return '真ん中のポーンを進めて、場所を取ろう。';
    return 'いまの局面では、この手がよさそう。';
  }

  // 指した直後の局面で、動いた駒が「得になる形で」ねらっている相手の駒（キング含む）
  function forkTargets(chess, m) {
    const enemy = opposite(m.color);
    const targets = [];
    for (const sq of SQUARES) {
      const pc = chess.get(sq);
      if (!pc || pc.color !== enemy) continue;
      if (!chess.attackers(sq, m.color).includes(m.to)) continue;
      const defended = chess.attackers(sq, enemy).length > 0;
      const piece = m.promotion || m.piece;
      if (pc.type === 'k' || VALUE[pc.type] > VALUE[piece] || (!defended && VALUE[pc.type] >= 3)) targets.push(pc.type);
    }
    // 動いた駒自体がただで取られるなら、両取りとは言えない
    if (hangingPieces(chess, m.color).some((h) => h.square === m.to)) return [];
    return targets;
  }

  // ヒント：AIで良い手を探して、なぜ良いのかをひとこと添える
  function hint(chess) {
    const scored = window.KasumiAI.scoreMoves(chess, { depth: 2, quiesce: true });
    if (!scored.length) return null;
    const m = scored[0].move;
    return { move: m, text: `${describeSquareMove(m)}（${m.from} → ${m.to}）。${reasonFor(chess, m)}` };
  }

  // ---------- 対局の振り返り ----------
  const ANALYSIS_VERSION = 1;
  const CLAMP = 1500; // 形勢グラフ用：駒15個ぶんで頭打ち

  // 1手ごとに「最善手との差」を測る。重いので1手ずつ間をあけて計算する。
  async function analyzeGame(game, onProgress) {
    const { Chess } = window.ChessLib;
    const AI = window.KasumiAI;
    const opts = { depth: 2, quiesce: true };
    const src = new Chess();
    src.loadPgn(game.pgn);
    const history = src.history({ verbose: true });
    const hinted = new Set(game.events.filter((e) => e.type === 'hint').map((e) => `${e.ply}:${e.san}`));
    const ignored = new Map(game.events.filter((e) => e.type === 'warning-ignored').map((e) => [`${e.ply}:${e.san}`, e]));
    const chess = new Chess();
    const plies = [];
    for (let i = 0; i < history.length; i++) {
      const h = history[i];
      const scored = AI.scoreMoves(chess, opts);
      const best = scored[0];
      const playedEntry = scored.find((s) => s.move.san === h.san);
      const loss = Math.max(0, best.score - playedEntry.score);
      const sign = h.color === 'w' ? 1 : -1;
      plies.push({
        san: h.san,
        from: h.from,
        to: h.to,
        color: h.color,
        by: h.color === game.playerColor ? 'player' : 'ai',
        best: { san: best.move.san, from: best.move.from, to: best.move.to },
        loss,
        evalWhite: Math.max(-CLAMP, Math.min(CLAMP, sign * playedEntry.score)),
        hinted: hinted.has(`${i}:${h.san}`),
        warned: ignored.has(`${i}:${h.san}`),
      });
      chess.move(h.san);
      if (onProgress) onProgress(i + 1, history.length);
      await new Promise((r) => setTimeout(r, 0));
    }
    explainPlies(plies, game);
    return { version: ANALYSIS_VERSION, plies, summary: summarize(plies, game) };
  }

  function tagFor(p) {
    if (/#$/.test(p.san)) return 'mate';
    if (p.loss >= 250) return 'blunder';
    if (p.loss >= 100) return 'mistake';
    if (p.loss <= 30) return 'good';
    return 'ok';
  }

  function moveAt(chess, san) {
    return chess.moves({ verbose: true }).find((m) => m.san === san);
  }

  // 各手の説明文と、盤に描く矢印・注意マスを作る
  function explainPlies(plies, game) {
    const { Chess } = window.ChessLib;
    const chess = new Chess();
    for (let i = 0; i < plies.length; i++) {
      const p = plies[i];
      p.tag = tagFor(p);
      const played = moveAt(chess, p.san);
      const best = moveAt(chess, p.best.san);
      const bestReason = reasonFor(chess, best);
      const playedReason = reasonFor(chess, played);
      chess.move(played);
      // この手のあと、相手のいちばん痛い返し
      const reply = p.tag === 'mate' ? null : window.KasumiAI.scoreMoves(chess, { depth: 2, quiesce: true })[0];
      const next = plies[i + 1];
      // 「なぜ悪いか」を具体的に言えるミスだけを指摘する（駒を取られる・詰む・取れる駒を逃す・両取り）
      const replyReason = reply ? reasonFor(chess, reply.move) : '';
      const concrete = (m, reason) => !!m && (!!m.captured || /#$/.test(m.san) || /^両取り/.test(reason));
      if (p.tag === 'blunder' || p.tag === 'mistake') {
        const explainable = p.by === 'player' ? concrete(reply && reply.move, replyReason) || concrete(best, bestReason) : concrete(reply && reply.move, replyReason);
        if (!explainable) p.tag = 'ok';
      }
      p.arrows = [{ from: p.from, to: p.to, kind: 'played' }];
      p.marks = [];
      const who = p.by === 'player' ? 'あなた' : 'AI';
      let text = `<b>${who}：${p.san}</b>　${describeMove(played)}。<br>`;
      if (p.tag === 'mate') {
        text += p.by === 'player' ? 'これでチェックメイト！キングはもうどこにも逃げられないね。' : 'チェックメイトされちゃった。';
      } else if (p.by === 'player') {
        if (p.tag === 'blunder' || p.tag === 'mistake') {
          p.kind = mistakeKind(reply && reply.move, best);
          text += `<b>ここが惜しかった。</b>この手のあと、相手は${describeAction(reply.move)}ことができる。`;
          if (/^両取り/.test(replyReason)) text += '（両取りになっちゃう）';
          if (next && next.san === reply.move.san) text += '（実際に AI もそうしたね）';
          text += `<br>代わりに <b>${p.best.san}</b>（${NAME[best.piece]} ${best.from} → ${best.to}）がよかった：${bestReason}`;
          p.arrows.push({ from: best.from, to: best.to, kind: 'best' });
          p.marks = [reply.move.from, reply.move.to];
        } else {
          const why = played.captured && /^相手の/.test(playedReason) ? '駒を取って得したね。' : playedReason;
          text += `${why}${p.tag === 'good' ? ' <b>いい手！</b>' : ''}`;
          if (p.hinted) text += '<br><span class="sub">（ヒントで見つけた手。理由もいっしょに覚えておこう）</span>';
        }
        if (p.warned) text += '<br><span class="sub">ガイドが「ちょっと待って」と止めた手だったよ。</span>';
      } else {
        if (p.tag === 'blunder' || p.tag === 'mistake') {
          text += `<b>AI のミス！</b>`;
          if (reply) {
            text += `ここであなたは${describeAction(reply.move)}ことができた：${replyReason}`;
            p.arrows.push({ from: reply.move.from, to: reply.move.to, kind: 'best' });
            p.chance = true;
            p.caught = !!next && next.san === reply.move.san;
            if (p.caught) text += '<br>→ ちゃんと見つけたね！これが勝ちにつながる一手。';
            else if (next) text += `<br>→ 実際は ${next.san} だったから、チャンスを見逃しちゃった。`;
          }
        } else {
          const threats = hangingPieces(chess, game.playerColor).filter((h) => h.loss >= 2);
          if (threats.length) {
            text += `ねらい：あなたの${NAME[threats[0].piece]}（${threats[0].square}）を取ろうとしてる。`;
            p.marks = [threats[0].square];
          } else {
            text += 'あなたの番。';
          }
        }
      }
      p.text = text;
    }
  }

  // プレイヤーのミスの種類（③のクセ分析でも使う）
  function mistakeKind(reply, best) {
    if (reply && /#$/.test(reply.san)) return 'allowed-mate';
    if (reply && reply.captured) return 'hung-piece';
    if (best.captured) return 'missed-capture';
    return 'other';
  }

  function summarize(plies, game) {
    const mine = plies.filter((p) => p.by === 'player');
    const turning = plies
      .map((p, i) => ({ i, p }))
      .filter(({ p }) => p.tag === 'blunder' || p.tag === 'mate')
      .sort((a, b) => (b.p.tag === 'mate') - (a.p.tag === 'mate') || b.p.loss - a.p.loss)
      .slice(0, 3)
      .sort((a, b) => a.i - b.i)
      .map(({ i, p }) => ({
        ply: i,
        label: `${Math.floor(i / 2) + 1}手目 ${p.by === 'player' ? 'あなた' : 'AI'}の ${p.san}`,
        note:
          p.tag === 'mate'
            ? '決着の一手'
            : p.by === 'player'
              ? { 'hung-piece': '駒をただで取られる手', 'allowed-mate': '詰みを許す手', 'missed-capture': '取れる駒を見逃した', other: '形勢を損ねた手' }[p.kind]
              : 'AI の大きなミス',
      }));
    const kinds = {};
    for (const p of mine) if (p.kind) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
    const topKind = Object.entries(kinds).sort((a, b) => b[1] - a[1])[0];
    const tip = topKind
      ? {
          'hung-piece': '駒を動かす前に「動かした先は相手にねらわれてない？」と1秒だけ確認してみよう。',
          'allowed-mate': '指す前に「相手がチェックしてくる手はある？」を見るクセをつけると、急な負けが減るよ。',
          'missed-capture': '自分の番が来たら、まず「ただで取れる駒はない？」を探してみよう。',
          other: '迷ったら、駒を真ん中に出す・キングを守る、の2つを意識してみよう。',
        }[topKind[0]]
      : '大きなミスなし！この調子。';
    const chances = plies.filter((p) => p.chance);
    const caught = chances.filter((p) => p.caught);
    let why;
    if (game.result === 'win') {
      why = chances.length
        ? `AI のミス ${chances.length} 回のうち ${caught.length} 回を、あなたがしっかりとがめて駒の数で上回ったのが勝因。下の「勝負の分かれ目」を見てみて。`
        : 'ていねいに指し続けて、最後に詰ませたのが勝因。';
    } else if (game.result === 'loss') {
      why = mine.some((p) => p.tag === 'blunder') ? '大きく形勢が傾いたのは下の「勝負の分かれ目」。そこを直せば、同じ相手にも勝てるはず。' : 'AI が少しずつ有利を広げていった対局。';
    } else {
      why = '最後まで決着がつかなかった対局。';
    }
    return {
      why,
      tip,
      turning,
      counts: {
        good: mine.filter((p) => p.tag === 'good').length,
        mistakes: mine.filter((p) => p.tag === 'mistake').length,
        blunders: mine.filter((p) => p.tag === 'blunder').length,
        chances: chances.length,
        caught: caught.length,
      },
      kinds,
    };
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
    describeAction,
    turnAdvice,
    hint,
    reasonFor,
    whyNotMate,
    analyzeGame,
    ANALYSIS_VERSION,
  };
})();
