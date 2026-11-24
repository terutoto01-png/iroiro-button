@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==============================================
echo  いろいろボタン マルチプレイ Worker の停止（削除）
echo ==============================================
echo.
echo Cloudflare 上の Worker (iroiro-multi) を停止・削除します。
echo ※ ゲーム本体は1人プレイとしてそのまま遊べます。
echo ※ 再開したいときは start-worker.bat を実行してください。
echo.
set /p ANS="本当に停止しますか？ (y/N): "
if /i not "%ANS%"=="y" (
  echo キャンセルしました。
  pause
  exit /b 0
)

echo.
echo Worker を停止しています...
call npx wrangler delete --force
if errorlevel 1 (
  echo.
  echo [エラー] 停止に失敗しました。ログインが必要な場合は npx wrangler login を実行してください。
) else (
  echo.
  echo [完了] Worker (iroiro-multi) を停止しました。
)
echo.
pause
