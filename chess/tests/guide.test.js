// 実行: node chess/tests/guide.test.js
global.window = {};
require('../vendor/chess.js');
require('../ai.js');
require('../guide.js');
const { Chess } = window.ChessLib;
const G = window.KasumiGuide;
let failed = 0;
function check(name, cond, detail) {
  if (!cond) failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ' → ' + detail : ''}`);
}

// クイーンをただで取られるマスへ動かそうとしたら止める
let c = new Chess('rnbqkb1r/pppppppp/5n2/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 1 2');
let w = G.checkMove(c, { from: 'd1', to: 'h5' });
check('クイーンを取られる手を警告', w && w.kind === 'hang' && w.piece === 'q', w && w.text);
check('普通の手には何も言わない', G.checkMove(c, { from: 'g1', to: 'f3' }) === null);

// 詰まされる手を警告（f3のポーンを動かすと Qh4#）
c = new Chess('rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2');
w = G.checkMove(c, { from: 'g2', to: 'g4' });
check('1手で詰まされる手を警告', w && w.kind === 'mate', w && w.text);

// 手番開始時：ねらわれている駒を教える
c = new Chess('rnbqkbnr/pppp1ppp/8/4p3/3N4/8/PPPPPPPP/R1BQKBNR w KQkq - 0 1');
let a = G.turnAdvice(c);
check('ねらわれているナイトを教える', a && a.kind === 'hanging' && a.squares.includes('d4'), a && a.text);

// スカラーズメイトのねらいを教える（黒番）
c = new Chess('r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3');
a = G.turnAdvice(c);
check('詰みのねらいを教える', a && a.kind === 'mate-threat', a && a.text);

// ヒントは詰みを見つける
c = new Chess('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
const h = G.hint(c);
check('ヒントが詰みを見つける', h && h.move.san === 'Ra8#', h && h.text);

// パズルで間違えたときの説明
c = new Chess('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1');
c.move('Ra7');
check('チェックでない手の説明', /チェックになってない/.test(G.whyNotMate(c)));

// 両取り（フォーク）を見つける：Nc7+ でキングとルーク
c = new Chess('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1');
const fork = c.moves({ verbose: true }).find((m) => m.san === 'Nc7+');
check('フォークを説明する', /両取り/.test(G.reasonFor(c, fork)), G.reasonFor(c, fork));

// 振り返り：ミスと決着の一手を見つける
(async () => {
  // 白=きつね、黒=ひよこで1局作る（乱数は固定）
  let seed = 7;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const g = new Chess();
  while (!g.isGameOver() && g.history().length < 120) g.move(window.KasumiAI.bestMove(g, g.turn() === 'w' ? 'kitsune' : 'hiyoko'));
  const game = {
    pgn: g.pgn(),
    playerColor: 'w',
    result: g.isCheckmate() ? 'win' : 'draw',
    events: [{ type: 'hint', ply: 0, san: g.history()[0] }],
  };
  const n = g.history().length;
  const t = Date.now();
  const a = await G.analyzeGame(game);
  check('全手を分析', a.plies.length === n, `${n}手 / ${Date.now() - t}ms / ${game.result}`);
  const aiBlunder = a.plies.find((p) => p.by === 'ai' && p.chance);
  check('AI のミスとチャンスを指摘', !!aiBlunder, aiBlunder && aiBlunder.text.replace(/<[^>]+>/g, ''));
  check('ヒントの手に印', a.plies[0].hinted);
  if (game.result === 'win') check('最後は決着の一手', a.plies[n - 1].tag === 'mate', a.plies[n - 1].text.replace(/<[^>]+>/g, ''));
  check('どの手にも説明がある', a.plies.every((p) => p.text && p.arrows.length >= 1));
  console.log('summary:', JSON.stringify(a.summary));
  process.exit(failed ? 1 : 0);
})();
