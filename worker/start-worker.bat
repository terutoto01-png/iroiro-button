@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==============================================
echo  いろいろボタン マルチプレイ Worker の再開
echo ==============================================
echo.
echo Worker (iroiro-multi) の公開 URL (workers.dev) を ON にして再開します...
echo.
call npx wrangler deploy
if errorlevel 1 (
  echo.
  echo [エラー] 再開に失敗しました。ログインが必要な場合は npx wrangler login を実行してください。
) else (
  echo.
  echo [完了] Worker (iroiro-multi) を再開しました。
)
echo.
pause
