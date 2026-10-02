# Netlify Drop への配置

1. フォルダを一つ作り、`furikaeri-cho.html` を `index.html` という名前でコピーする。
2. 同じフォルダに、このディレクトリの `_headers` をコピーする。
3. https://app.netlify.com/drop にフォルダごとドラッグする。

`_headers` は、ページの外部通信を禁じる設定（CSP）などを、サーバーの応答としても送るためのもの。
Netlify の管理画面で「Snippet injection」（スクリプトの差し込み）は使わないこと。
