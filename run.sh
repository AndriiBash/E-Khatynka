#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -d "$SCRIPT_DIR/files" ] && [ -f "$SCRIPT_DIR/files/tsconfig.json" ]; then
  ROOT="$SCRIPT_DIR/files"
elif [ -f "$SCRIPT_DIR/tsconfig.json" ]; then
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
echo ""

echo "📥 npm install..."
npm install

echo ""
echo "📦 npm run build..."
npm run build

echo ""
echo "🌐 npm start..."
echo "   Press Control+C to stop"
echo ""
npm start