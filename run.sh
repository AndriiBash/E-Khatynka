#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -d "$SCRIPT_DIR/files" ] && [ -f "$SCRIPT_DIR/files/tsconfig.json" ]; then
  ROOT="$SCRIPT_DIR/files"
elif [ -f "$SCRIPT_DIR/tsconfig.json" ] && [ -d "$SCRIPT_DIR/src/ts" ]; then
  ROOT="$SCRIPT_DIR"
else
  echo "❌ Project not found."
  echo "   Place run.sh in the repository root (where the files/ folder exists) or inside files/."
  exit 1
fi

cd "$ROOT"
echo "🚀 E-Khatynka"
echo "📂 $ROOT"
echo ""

if ! command -v npm &> /dev/null; then
  echo "❌ npm not found."
  echo "   Install Node.js: brew install node"
  exit 1
fi
echo "✅ npm $(npm -v)"

if [ ! -f package.json ]; then
  echo "📄 Creating package.json..."
  npm init -y >/dev/null 2>&1
fi

if [ ! -x node_modules/.bin/tsc ]; then
  echo "📥 Installing TypeScript..."
  npm install --save-dev typescript --no-fund --no-audit
fi
echo "✅ TypeScript is ready"

if [ ! -f tsconfig.json ]; then
  echo "❌ tsconfig.json not found in $ROOT"
  exit 1
fi

echo ""
echo "📦 Compiling src/ts → dist/js ..."
./node_modules/.bin/tsc -p tsconfig.json
echo "✅ Build successful"
echo ""

echo "🌐 Server: $URL"
echo "   Press Control+C to stop"
echo ""

npx serve .