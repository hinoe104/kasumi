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

process.exit(failed ? 1 : 0);
