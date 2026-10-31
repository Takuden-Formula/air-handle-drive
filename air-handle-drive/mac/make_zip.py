# Mac 配布用の ZIP（air-handle-drive-mac.zip）を作る。中身は air-handle-drive フォルダだけ
# 実行権限（.command など）と日本語のファイル名（UTF-8）を残し、Mac の「アーカイブユーティリティ」でそのまま展開できる形にする
# 使い方（リポジトリの一番上で）: python air-handle-drive/mac/make_zip.py <出力先.zip>
# コミット済みの内容（git の HEAD）から作るので、改行は LF のまま入る
import subprocess, sys, time, zipfile

out = sys.argv[1] if len(sys.argv) > 1 else 'air-handle-drive-mac.zip'
ls = subprocess.run(['git', 'ls-files', '-s', '-z', 'air-handle-drive'], capture_output=True, check=True).stdout.decode('utf-8')
now = time.localtime()[:6]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    dirs = set()
    for ent in filter(None, ls.split('\0')):
        meta, path = ent.split('\t', 1)
        mode, sha = meta.split()[:2]
        parts = path.split('/')
        for i in range(1, len(parts)):
            d = '/'.join(parts[:i]) + '/'
            if d not in dirs:
                dirs.add(d); zi = zipfile.ZipInfo(d, now); zi.create_system = 3; zi.external_attr = (0o40755 << 16) | 0x10; z.writestr(zi, b'')
        data = subprocess.run(['git', 'cat-file', 'blob', sha], capture_output=True, check=True).stdout
        zi = zipfile.ZipInfo(path, now); zi.create_system = 3
        zi.external_attr = ((0o100755 if mode == '100755' else 0o100644) << 16)
        zi.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(zi, data)
print(out)
