// 実行: node chess/tests/puzzles.test.js
global.window = {};
require('../vendor/chess.js');
require('../puzzles.js');
const { Chess } = window.ChessLib;
let failed = 0;
const ids = window.KasumiPuzzles.map((p) => p.id);
const levels = window.KasumiPuzzleLevels.map((l) => l.key);
if (new Set(ids).size !== ids.length) { failed++; console.log('FAIL id が重複している'); }
for (const p of window.KasumiPuzzles) {
  const c = new Chess(p.fen);
  const mates = c.moves({ verbose: true }).filter((m) => {
    c.move(m);
    const mate = c.isCheckmate();
    c.undo();
    return mate;
  });
  // 画面ではポーンは必ずクイーンに成るので、それで解けること
  const playable = mates.some((m) => !m.promotion || m.promotion === 'q');
  const ok = !c.isGameOver() && !c.inCheck() && playable && levels.includes(p.level) && !!p.hint && !!p.lesson;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${p.title}: ${mates.map((m) => m.san).join(', ') || '(詰みなし)'}`);
}
process.exit(failed ? 1 : 0);
