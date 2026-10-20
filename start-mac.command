#!/bin/bash
# Double-click in Finder to start the application.
cd "$(dirname "$0")"
# Programs started from a file manager don't load ~/.bashrc / ~/.zshrc, so Node installed with
# nvm, fnm, volta, asdf or Homebrew may be missing from PATH. Look in the usual places.
find_node() {
  command -v node >/dev/null 2>&1 && return 0
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh" >/dev/null 2>&1; command -v node >/dev/null 2>&1 && return 0; fi
  for d in "$NVM_DIR"/versions/node/*/bin "$HOME/.volta/bin" "$HOME/.asdf/shims" "$HOME/.local/share/fnm/aliases/default/bin" "$HOME/.fnm/aliases/default/bin" "$HOME/.local/bin" /usr/local/bin /opt/homebrew/bin; do
    if [ -x "$d/node" ]; then PATH="$d:$PATH"; export PATH; return 0; fi
  done
  return 1
}
if ! find_node; then
  echo "Node.js is not installed. Download the LTS version from https://nodejs.org and run this again."
  read -r -p "Press Enter to close"
  exit 1
fi
if [ ! -f dist/index.html ]; then
  echo "First run: installing and building (needs internet once)..."
  npm install && npm run build
fi
node scripts/serve.mjs
