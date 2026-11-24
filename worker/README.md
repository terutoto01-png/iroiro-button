# いろいろボタン マルチプレイ中継サーバー（Cloudflare Workers + Durable Objects）

Cloudflare Workers **Free プラン**（SQLite バックエンド Durable Objects + WebSocket Hibernation API）で動作します。

## ローカルで試す（アカウント不要）

```bash
cd worker
npm install
npm run dev:lan   # ポート 8787 で起動（同じ Wi-Fi の iPad からも接続可能）
```

この状態で別ターミナルからアプリを配信（例: `python -m http.server 8765`）して `http://<PCのIP>:8765/beru.html` などを複数端末で開くと自動で接続されます。

## Cloudflare にデプロイする

1. https://dash.cloudflare.com/sign-up/workers-and-pages で無料アカウントを作成
2. ログインしてデプロイ：
   ```bash
   cd worker
   npx wrangler login
   npm run deploy
   ```
3. 表示された `https://iroiro-multi.<サブドメイン>.workers.dev` を、親ディレクトリの `multi.js` にある `PROD_WS` に `wss://...` 形式で設定

## 家族だけで遊ぶ（プライベート部屋）

URL の末尾に `?room=好きな英数字` を付けて開くと、その合言葉を知っている端末だけで繋がります（メニュー経由でも記憶されます）。
