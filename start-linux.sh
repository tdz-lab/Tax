#!/bin/bash
# Double-click in Finder to start the application.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org and run this again."
  read -r -p "Press Enter to close"
  exit 1
fi
if [ ! -f dist/index.html ]; then
  echo "First run: installing and building (needs internet once)..."
  npm install && npm run build
fi
node scripts/serve.mjs
