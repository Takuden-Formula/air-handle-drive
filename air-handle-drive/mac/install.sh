#!/bin/bash
# Air Handle Drive - Mac にダウンロードして展開する（ターミナルに1行貼るだけ）
#   curl -fsSL https://raw.githubusercontent.com/salt6004/takuden-formula-2025/mac-support/air-handle-drive/mac/install.sh | bash
# ブラウザでダウンロードしたものと違い「開発元を検証できません」の警告が出ない（curl は隔離の印を付けないため）
set -e
URL="https://github.com/salt6004/takuden-formula-2025/archive/refs/heads/mac-support.zip"   # ブランチの最新
DEST="${1:-$HOME/Desktop}"
[ -d "$DEST" ] || DEST="$HOME"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/ahd.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo "ダウンロードしています…（約 15 MB）"
curl -fL --progress-bar -o "$TMP/a.zip" "$URL"
ditto -x -k "$TMP/a.zip" "$TMP/x"
SRC="$(find "$TMP/x" -maxdepth 2 -type d -name air-handle-drive | head -1)"   # ZIP の中のゲームのフォルダだけ使う
[ -n "$SRC" ] || { echo "ZIP の中に air-handle-drive がありません"; exit 1; }
if [ -e "$DEST/air-handle-drive" ]; then
  OLD="$DEST/air-handle-drive_old_$(date +%Y%m%d_%H%M%S)"
  mv "$DEST/air-handle-drive" "$OLD"
  echo "前の版は $OLD に残しました（記録 records.csv を置いていたら移してください）"
fi
ditto "$SRC" "$DEST/air-handle-drive"
xattr -dr com.apple.quarantine "$DEST/air-handle-drive" 2>/dev/null || true
chmod +x "$DEST/air-handle-drive/"*.command "$DEST/air-handle-drive/mac/"*.sh "$DEST/air-handle-drive/mac/"*.pl 2>/dev/null || true
echo
echo "できました: $DEST/air-handle-drive"
echo "開いたフォルダの「起動_Mac.command」をダブルクリックするとゲームが始まります"
open "$DEST/air-handle-drive"
