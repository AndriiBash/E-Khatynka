#!/bin/bash

echo "🚀 Starting E-Khatynka..."

# Navigate to the project directory
cd "$(dirname "$0")/src"

echo "📦 Checking npm..."

if ! command -v npm &> /dev/null
then
    echo "❌ npm not found."
    echo "Install Node.js via Homebrew:"
    echo "brew install node"
    exit 1
fi

echo "✅ npm found"

# Create package.json if it does not exist
if [ ! -f package.json ]; then
    echo "📄 Creating package.json..."
    npm init -y
fi

# Install TypeScript if it is not installed
if [ ! -f node_modules/.bin/tsc ]; then
    echo "📥 TypeScript not found. Installing..."
    npm install --save-dev typescript
fi

echo "✅ TypeScript found"

# Create tsconfig.json if it does not exist
if [ ! -f tsconfig.json ]; then
    echo "⚙️ Creating tsconfig.json..."

    cat > tsconfig.json << 'EOF'
{
    "compilerOptions": {
        "target": "ES2020",
        "module": "ES2020",
        "strict": true,
        "rootDir": "./scripts",
        "outDir": "./dist"
    },
    "include": ["scripts/**/*.ts"]
}
EOF
fi

echo "📦 Compiling TypeScript..."

./node_modules/.bin/tsc

if [ $? -ne 0 ]; then
    echo "❌ TypeScript compilation failed!"
    exit 1
fi

echo "✅ TypeScript compiled successfully"
echo "🌐 Starting E-Khatynka..."
echo "👉 http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop"

open "http://localhost:8000"
python3 -m http.server 8000