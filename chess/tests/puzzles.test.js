// 実行: node chess/tests/puzzles.test.js
global.window = {};
require('../vendor/chess.js');
require('../puzzles.js');
const { Chess } = window.ChessLib;
let failed = 0;
for (const p of window.KasumiPuzzles) {
  const c = new Chess(p.fen);
  const mates = c.moves({ verbose: true }).filter((m) => {
    c.move(m);
    const mate = c.isCheckmate();
    c.undo();
    return mate;
  });
  const ok = !c.isGameOver() && !c.inCheck() && mates.length > 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${p.title}: ${mates.map((m) => m.san).join(', ') || '(詰みなし)'}`);
}
process.exit(failed ? 1 : 0);
