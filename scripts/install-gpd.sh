#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"
export NEXT_TELEMETRY_DISABLED=1
node -e 'if(Number(process.versions.node.split(".")[0])!==24)throw Error("Install Node.js 24 LTS first")'
npm ci
npm test
npm run build
mkdir -p "$HOME/.config/systemd/user" "$HOME/.local/share/bookauthor" "$HOME/.local/share/applications"
if [ ! -f .env.local ]; then
  printf 'LOOM_OFFLINE=1\nNEXT_TELEMETRY_DISABLED=1\nLOOM_DATA_DIR=%s/.local/share/bookauthor\nLOCAL_AI_BASE_URL=http://127.0.0.1:8080/v1\nLOCAL_AI_MODEL=qwen36-huihui\n' "$HOME" > .env.local
  chmod 600 .env.local
fi
nodepath=$(command -v node)
cat > "$HOME/.config/systemd/user/bookauthor.service" <<EOF
[Unit]
Description=BookAuthor offline writing studio
After=local-ai.service
Wants=local-ai.service

[Service]
Type=simple
WorkingDirectory=$PWD
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=$nodepath $PWD/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF
cat > "$HOME/.local/share/applications/bookauthor.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=BookAuthor Offline
Comment=Local book writing and editing studio
Exec=xdg-open http://127.0.0.1:3000
Icon=accessories-text-editor
Terminal=false
Categories=Office;
EOF
systemctl --user daemon-reload
systemctl --user enable bookauthor
systemctl --user restart bookauthor
echo 'BookAuthor: http://127.0.0.1:3000'
