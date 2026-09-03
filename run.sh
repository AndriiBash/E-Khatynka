#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -d "$SCRIPT_DIR/files" ] && [ -f "$SCRIPT_DIR/files/tsconfig.json" ]; then
  ROOT="$SCRIPT_DIR/files"
elif [ -f "$SCRIPT_DIR/tsconfig.json" ] && [ -d "$SCRIPT_DIR/src/ts" ]; then
  ROOT="$SCRIPT_DIR"
else
  echo "❌ Не знайдено проєкт."
  echo "   Поклади run.sh у корінь репо (де є папка files/) або всередину files/."
  exit 1
fi

cd "$ROOT"
echo "🚀 Є-Хатинка"
echo "📂 $ROOT"
echo ""

if ! command -v npm &> /dev/null; then
  echo "❌ npm не знайдено."
  echo "   Встанови Node.js: brew install node"
  exit 1
fi
echo "✅ npm $(npm -v)"

if [ ! -f package.json ]; then
  echo "📄 Створюю package.json..."
  npm init -y >/dev/null 2>&1
fi

if [ ! -x node_modules/.bin/tsc ]; then
  echo "📥 Встановлюю TypeScript..."
  npm install --save-dev typescript --no-fund --no-audit
fi
echo "✅ TypeScript готовий"

if [ ! -f tsconfig.json ]; then
  echo "❌ Немає tsconfig.json у $ROOT"
  exit 1
fi

echo ""
echo "📦 Компіляція src/ts → dist/js ..."
./node_modules/.bin/tsc -p tsconfig.json
echo "✅ Збірка успішна"
echo ""

PORT="${PORT:-8000}"
URL="http://localhost:${PORT}"

echo "🌐 Сервер: $URL"
echo "   Ctrl+C — зупинити"
echo ""

npx --yes serve -l "$PORT" . &
SERVER_PID=$!

for i in $(seq 1 20); do
  if curl -s -o /dev/null --connect-timeout 0.5 "$URL" 2>/dev/null; then
    break
  fi
  sleep 0.4
done
sleep 0.6

if command -v open &> /dev/null; then
  open "$URL" 2>/dev/null || true
elif command -v xdg-open &> /dev/null; then
  xdg-open "$URL" 2>/dev/null || true
fi

wait "$SERVER_PID"