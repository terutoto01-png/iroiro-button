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

URL の末尾に `?room=好きな英数字` を付けて開くと、その合言葉を知っている端末だけの **グループ部屋**（`/ws/group--合言葉`）に繋がります。
合言葉はその端末に記憶されます（ホーム画面のアプリでも続く）。`?room=` だけを付けて開くと消えます。

グループ部屋では:
- メニューも全部のボタンも 1 本の接続のまま（メニュー = index.html が入れ物で、ボタンはその中の iframe で開く）。
- だれかがボタンに入る / 🏠 で戻ると、みんな同じところへ移動する。2 秒以内の別の移動は先に来た方を優先。
- あとから来た端末は、みんながいるボタンへ自動で移動する。
- メニューでは、なかまが指を置いたボタン・見ている なかま（ジャンプボタンの横）に動物が出る。
- ボタンの中の同期（花火など 6 ページ）は、同じページにいる人どうしだけに中継する。

合言葉なしのときは今まで通り、マルチ対応のページにいるあいだだけ、そのページの部屋（`/ws/hanabi` など）に繋がります。

> サーバーとページの通信のしかたが変わったので、ページ（GitHub Pages）を更新する前に `npm run deploy` で Worker を更新してください。
