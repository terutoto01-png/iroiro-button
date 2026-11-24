@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==============================================
echo  いろいろボタン マルチプレイ Worker の一時停止
echo ==============================================
echo.
echo Worker (iroiro-multi) を削除せず、公開 URL (workers.dev) だけ OFF にして停止します。
echo ※ ゲーム本体は1人プレイとしてそのまま遊べます。
echo ※ 再開したいときは start-worker.bat を実行してください。
echo.
set /p ANS="一時停止しますか？ (y/N): "
if /i not "%ANS%"=="y" (
  echo キャンセルしました。
  pause
  exit /b 0
)

echo.
echo Worker の公開 URL を OFF にしています...
call npx wrangler deploy -c wrangler.stop.jsonc
if errorlevel 1 (
  echo.
  echo [エラー] 停止に失敗しました。ログインが必要な場合は npx wrangler login を実行してください。
) else (
  echo.
  echo [完了] Worker (iroiro-multi) を一時停止しました（削除していません）。
)
echo.
pause
