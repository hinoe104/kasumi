/** Checks GitHub Releases for a newer build and offers a one-click update (native app only). */
export async function checkForUpdate(beforeInstall: () => Promise<void>) {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { check } = await import("@tauri-apps/plugin-updater");
  const { relaunch } = await import("@tauri-apps/plugin-process");
  let update;
  try { update = await check(); } catch { return; } // offline etc.
  if (!update) return;

  const bar = document.createElement("div");
  bar.id = "updateBar";
  const msg = document.createElement("span");
  msg.textContent = `新しいバージョン ${update.version} があります`;
  const go = document.createElement("button");
  go.className = "primary"; go.textContent = "更新して再起動";
  const later = document.createElement("button");
  later.textContent = "あとで";
  later.onclick = () => bar.remove();
  go.onclick = async () => {
    go.disabled = later.disabled = true;
    try {
      await beforeInstall();
      let total = 0, done = 0;
      await update.downloadAndInstall(ev => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") { done += ev.data.chunkLength; if (total) msg.textContent = `ダウンロード中… ${Math.round((done / total) * 100)}%`; }
        if (ev.event === "Finished") msg.textContent = "インストール中…";
      });
      await relaunch();
    } catch (e) {
      msg.textContent = "更新に失敗しました: " + (e as Error).message;
      later.disabled = false;
    }
  };
  bar.append(msg, go, later);
  document.body.append(bar);
}
