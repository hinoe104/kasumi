// 記録の保存先。
// - いつでも：この端末の localStorage（すぐ読める・オフラインでも動く）
// - claude.ai で開いたとき：あなた専用のクラウド保存（db capability の data/users/<id>/）。
//   ページを更新しても、別の端末で開いても、同じ記録が見られる。
// 起動時に両方を突き合わせて、片方にしかない記録はもう片方へコピーする。
(function () {
  const KEY = {
    games: 'kasumi-chess-games-v1',
    current: 'kasumi-chess-current-v1',
    solvedLegacy: 'kasumi-chess-solved-v1', // 問題が8問だったころの「何問目」形式
    solved: 'kasumi-chess-solved-v2',
  };
  const LEGACY_IDS = ['backrank', 'queen-king', 'ladder', 'smothered', 'scholar', 'arabian', 'promotion', 'backrank-black'];

  // localStorage はプライベートモード等で使えないことがあるので、失敗しても動くようにする
  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeLocal(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 保存できなくても遊べる */
    }
  }

  function localSolved() {
    const ids = new Set(readLocal(KEY.solved, []));
    for (const i of readLocal(KEY.solvedLegacy, [])) if (LEGACY_IDS[i]) ids.add(LEGACY_IDS[i]);
    return ids;
  }

  const cache = {
    games: readLocal(KEY.games, []),
    current: readLocal(KEY.current, null),
    solved: localSolved(),
  };
  // 'local'：この端末だけ / 'syncing'：クラウドと突き合わせ中 / 'cloud'：クラウド保存中 / 'error'：クラウドに書けなかった
  let status = 'local';
  let refs = null; // { games, current, progress }
  const listeners = new Set();

  function emit(what) {
    for (const fn of listeners) fn(what, status);
  }

  // 同じドキュメントへの書き込みは1つずつ。待っている間に来た新しい値は最後の1つだけ書く。
  const queues = new Map();
  function writeRemote(ref, value) {
    if (!ref) return;
    const q = queues.get(ref.path) || { running: false, next: undefined };
    queues.set(ref.path, q);
    q.next = value;
    if (q.running) return;
    q.running = true;
    (async () => {
      while (q.next !== undefined) {
        const v = q.next;
        q.next = undefined;
        try {
          if (v === null) await ref.delete();
          else await ref.set(v);
        } catch (e) {
          if (e && e.code === 'unavailable') {
            await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000));
            if (q.next === undefined) q.next = v;
            continue;
          }
          status = 'error';
          emit('status');
        }
      }
      q.running = false;
    })();
  }

  function sortGames() {
    cache.games.sort((a, b) => (b.endedAt || '').localeCompare(a.endedAt || ''));
  }

  async function connect() {
    if (!window.claude || typeof window.claude.use !== 'function') return;
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return;
    const uid = await user.id();
    if (!uid) return;
    status = 'syncing';
    emit('status');
    try {
      const base = db.collection('data/users/' + uid);
      refs = {
        progress: base.doc('chess-progress'),
        current: base.doc('chess-current'),
        games: base.doc('chess-progress').collection('games'),
      };
      const [gamesSnap, progressSnap, currentSnap] = await Promise.all([refs.games.get(), refs.progress.get(), refs.current.get()]);

      // 対局記録：両方を合わせる（分析済みのほうを優先）
      const remote = new Map(gamesSnap.docs.map((d) => [d.id, d.data()]));
      const merged = new Map();
      for (const g of cache.games) merged.set(g.id, g);
      let dataChanged = false;
      for (const [id, g] of remote) {
        const mine = merged.get(id);
        if (!mine || (!mine.analysis && g.analysis)) {
          merged.set(id, JSON.parse(JSON.stringify(g)));
          dataChanged = true;
        }
      }
      cache.games = [...merged.values()];
      sortGames();
      writeLocal(KEY.games, cache.games);
      for (const g of cache.games) {
        const r = remote.get(g.id);
        if (!r || (!r.analysis && g.analysis)) await refs.games.doc(g.id).set(g);
      }

      // 1手詰めの進み具合：どちらかで解いていれば解いたことにする
      const remoteSolved = progressSnap.exists ? progressSnap.data().solved || [] : [];
      const before = cache.solved.size;
      for (const id of remoteSolved) cache.solved.add(id);
      if (cache.solved.size !== before) dataChanged = true;
      writeLocal(KEY.solved, [...cache.solved]);
      if (cache.solved.size !== remoteSolved.length) await refs.progress.set({ solved: [...cache.solved] });

      // 途中の対局：新しいほうを使う
      const rc = currentSnap.exists ? currentSnap.data() : null;
      const remoteCurrent = rc && rc.game ? rc.game : null;
      let currentChanged = false;
      if (remoteCurrent && (!cache.current || (remoteCurrent.updatedAt || '') > (cache.current.updatedAt || ''))) {
        cache.current = JSON.parse(JSON.stringify(remoteCurrent));
        writeLocal(KEY.current, cache.current);
        currentChanged = true;
      } else if (cache.current && (!remoteCurrent || cache.current.updatedAt !== remoteCurrent.updatedAt)) {
        await refs.current.set({ game: cache.current });
      }

      status = 'cloud';
      emit('status');
      if (dataChanged) emit('data');
      if (currentChanged) emit('current');
    } catch (e) {
      status = 'error';
      emit('status');
    }
  }

  window.KasumiStore = {
    get status() {
      return status;
    },
    onChange(fn) {
      listeners.add(fn);
    },
    games() {
      return cache.games;
    },
    saveGame(game) {
      const i = cache.games.findIndex((g) => g.id === game.id);
      if (i >= 0) cache.games[i] = game;
      else cache.games.unshift(game);
      sortGames();
      writeLocal(KEY.games, cache.games);
      if (refs) writeRemote(refs.games.doc(game.id), game);
    },
    current() {
      return cache.current;
    },
    saveCurrent(value) {
      cache.current = value ? { ...value, updatedAt: new Date().toISOString() } : null;
      writeLocal(KEY.current, cache.current);
      if (refs) writeRemote(refs.current, cache.current ? { game: cache.current } : null);
    },
    solved() {
      return cache.solved;
    },
    addSolved(id) {
      if (cache.solved.has(id)) return;
      cache.solved.add(id);
      writeLocal(KEY.solved, [...cache.solved]);
      if (refs) writeRemote(refs.progress, { solved: [...cache.solved] });
    },
    connect,
  };
})();
