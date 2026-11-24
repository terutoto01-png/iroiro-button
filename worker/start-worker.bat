@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==============================================
echo  いろいろボタン マルチプレイ Worker の再開（デプロイ）
echo ==============================================
echo.
echo Cloudflare 上へ Worker (iroiro-multi) をデプロイします...
echo.
call npm run deploy
if errorlevel 1 (
  echo.
  echo [エラー] デプロイに失敗しました。ログインが必要な場合は npx wrangler login を実行してください。
) else (
  echo.
  echo [完了] Worker (iroiro-multi) が起動しました。
)
echo.
pause
