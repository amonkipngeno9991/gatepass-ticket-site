#!/data/data/com.termux/files/usr/bin/bash
# Run this from inside Termux, from the ticket-site folder:
#   bash termux-setup.sh
set -e

echo "== GatePass Termux setup =="

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js..."
  pkg update -y
  pkg install -y nodejs
else
  echo "Node.js already installed: $(node --version)"
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
NODE_MINOR=$(node -p "process.versions.node.split('.')[1]")
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 5 ]; }; then
  echo ""
  echo "Your Node version ($(node --version)) is too old for this app (needs 22.5+)."
  echo "Try: pkg uninstall nodejs && pkg install nodejs"
  exit 1
fi

echo ""
echo "Starting GatePass..."
echo "Once you see 'GatePass running at http://localhost:3000', open that"
echo "address in your Android browser. Press Ctrl+C here to stop the server."
echo ""
node server.js
