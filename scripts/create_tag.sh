#!/usr/bin/env bash
# scripts/create_tag.sh —— 一站式发版 tag:版本 bump + CHANGELOG 转正 + 提交 + 打 tag + 推送。
#
# 用法:
#   ./scripts/create_tag.sh             # 默认:当前版本末位 +1(0.0.5 → 0.0.6)
#   ./scripts/create_tag.sh 0.1.0       # 自定义版本(带 v 前缀亦可)
#   ./scripts/create_tag.sh --dry-run   # 只打印计划,不改动任何东西
#   ./scripts/create_tag.sh --no-push   # 本地提交 + 打 tag,但不推送
#   ./scripts/create_tag.sh --yes 0.1.0 # 跳过推送前确认
#
# 单条命令完成的事(参考 ZhuYe scripts/create_tag.sh,口径适配本仓库):
#   1. 前置校验:main 分支 + 工作区干净 + 不落后远端 + submodule 指针已提交
#      且其 HEAD 已推上 ZhuYe 远端(否则全新 clone 取不到指针,发布 gate 必红)
#   2. 计算目标版本(无参数时当前版本末位 +1;预发布后缀版本必须显式指定)
#   3. 版本四处同步 bump(package.json / Cargo.toml / tauri.conf.json;
#      src-tauri 走 workspace 继承)+ cargo check 刷新 Cargo.lock + 事后复核
#   4. CHANGELOG 转正:「## 未发布」段改题为版本段,顶部补新的空「未发布」段
#      —— release gate 的 check_changelog 要求 `## <ver>` 条目存在,缺了必红
#   5. 本地跑一遍静态门禁(tests/static/run.sh)→ 提交 → 打 annotated tag → 推送
#
# ⚠️ 推送 v* tag 会触发 release.yml → release gate(静态 + 前端 + 后端 + e2e)
#    全绿后四平台打包(dmg / AppImage / deb / msi)发 GitHub Release(公开)。
# 发版后记得把 develop 快进到 main:git push origin main:develop

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CARGO_TOML="$ROOT/Cargo.toml"
PKG_JSON="$ROOT/package.json"
TAURI_CONF="$ROOT/src-tauri/tauri.conf.json"
CHANGELOG="$ROOT/docs/CHANGELOG.md"
SUBMODULE="$ROOT/zhuye-agent"

die() { echo "FAIL: $*" >&2; exit 1; }

# ── 版本号读取(与 tests/static/run.sh 的 check_versions 同一口径)─────────
pkg_version()   { node -p "require('$PKG_JSON').version" 2>/dev/null; }
cargo_version() {
  awk '/^\[package\]$/{f=1;next} /^\[/{f=0} f && /^version = /{print; exit}' \
    "$CARGO_TOML" | cut -d'"' -f2
}
tauri_version() { node -p "require('$TAURI_CONF').version" 2>/dev/null; }
versions_consistent() {
  local p c t
  p="$(pkg_version)"; c="$(cargo_version)"; t="$(tauri_version)"
  [ -n "$p" ] && [ "$p" = "$c" ] && [ "$c" = "$t" ]
}

is_semver() {
  printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'
}

# ── 参数解析 -------------------------------------------------------------
DRY_RUN=false NO_PUSH=false ASSUME_YES=false VER_ARG=""
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --no-push) NO_PUSH=true ;;
    --yes|-y)  ASSUME_YES=true ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) [ -z "$VER_ARG" ] || die "只能指定一个版本,已收到:$VER_ARG 与 $arg"
       VER_ARG="$arg" ;;
  esac
done

# ── 1. 前置校验 ----------------------------------------------------------
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)"
# 分支约束属于安全边界:发版 tag 必须打在 main 上,否则版本提交与 tag
# 会落在未合并的分支上,发布流水线拿到的代码与 main 不符。
[ "$BRANCH" = "main" ] || die "当前分支是 $BRANCH —— 本脚本只能在 main 分支使用。"

[ -z "$(git -C "$ROOT" status --porcelain)" ] \
  || die "工作区不干净 —— 版本提交不能混入无关改动,请先提交或暂存(stash)。"

# 本地不得落后远端(领先没关系,版本提交马上会推上去);fetch 失败仅警告(离线可用)。
if git -C "$ROOT" fetch origin main --quiet 2>/dev/null; then
  BEHIND="$(git -C "$ROOT" rev-list --count main..origin/main)"
  [ "$BEHIND" = "0" ] || die "本地 main 落后 origin/main $BEHIND 个提交 —— 先 git pull。"
else
  echo "WARN: 无法 fetch origin(离线?)—— 跳过远端同步校验。"
fi

# submodule:指针必须已提交(干净工作区已保证),内部无未提交改动,
# 且其 HEAD 已在 ZhuYe 远端的分支上可达 —— 指向未推送 commit 时,
# 全新 clone 的 CI 取不到该对象,release gate 必然失败。
[ -z "$(git -C "$SUBMODULE" status --porcelain)" ] \
  || die "zhuye-agent submodule 内部有未提交改动 —— 核心改动回 ZhuYe 仓库提交。"
if git -C "$SUBMODULE" fetch origin --quiet 2>/dev/null; then
  [ -n "$(git -C "$SUBMODULE" branch -r --contains HEAD 2>/dev/null)" ] \
    || die "zhuye-agent 指向 $(git -C "$SUBMODULE" rev-parse --short HEAD),\
该 commit 不在 ZhuYe 远端任何分支上 —— 先推送上游,或先 submodule update --remote。"
else
  echo "WARN: 无法 fetch ZhuYe 远端(离线?)—— 跳过 submodule 指针可达性校验。"
fi

versions_consistent || die "版本号不一致 —— 先修复后再发版(tests/static/run.sh 同口径):
  package.json:    $(pkg_version)
  Cargo.toml:      $(cargo_version)
  tauri.conf.json: $(tauri_version)"

CUR="$(pkg_version)"

# ── 2. 计算目标版本 ------------------------------------------------------
if [ -n "$VER_ARG" ]; then
  NEW="${VER_ARG#v}"                       # 兼容 v0.1.0 写法
  is_semver "$NEW" || die "非法版本号:$VER_ARG(应为 0.1.0 这样的三段式)"
else
  # 末位 +1:最后一段必须是纯数字;预发布版本(0.1.0-rc.1)语义上
  # 「+1」不明确,必须显式指定目标版本。
  LAST="${CUR##*.}"
  printf '%s' "$LAST" | grep -Eq '^[0-9]+$' \
    || die "当前版本 $CUR 带预发布后缀,无法自动 +1 —— 请显式指定目标版本。"
  NEW="${CUR%.*}.$((LAST + 1))"
fi
[ "$NEW" != "$CUR" ] || die "目标版本 $NEW 与当前版本相同,无事可做。"

git -C "$ROOT" rev-parse -q --verify "refs/tags/v$NEW" > /dev/null \
  && die "tag v$NEW 已存在 —— 换一个版本,或先清理旧 tag。"

echo "发版计划:$CUR → $NEW,tag v$NEW(分支 $BRANCH)"

if $DRY_RUN; then
  echo
  echo "── dry-run:将执行以下动作 ──"
  echo "  1. bump 三处版本:$PKG_JSON / $CARGO_TOML / $TAURI_CONF(src-tauri 走继承)"
  echo "  2. cargo check --workspace 刷新 Cargo.lock"
  echo "  3. CHANGELOG「## 未发布」段改题为 $NEW,顶部补新「未发布」段"
  echo "  4. bash tests/static/run.sh(本地过一遍静态门禁)"
  echo "  5. git commit + git tag -a v$NEW"
  $NO_PUSH && echo "  6. (--no-push)不推送" \
            || echo "  6. git push origin main v$NEW(触发 release 流水线)"
  echo "dry-run 结束,未改动任何东西。"
  exit 0
fi

# ── 3. 版本写入 + Cargo.lock 刷新 + CHANGELOG 转正 -------------------------
# 只动三处版本锚点行,不碰依赖版本;CHANGELOG 的「未发布」段改题为版本段
# (release gate 的 check_changelog 要求 ## <ver> 条目),顶部补新的空段供下次积累。
python3 - "$PKG_JSON" "$CARGO_TOML" "$TAURI_CONF" "$CHANGELOG" "$CUR" "$NEW" "$(date +%F)" <<'PYEOF'
import pathlib, sys

pkg, cargo, tauri, changelog, old, new, today = sys.argv[1:8]

# ── package.json / tauri.conf.json:键唯一,直接替换 ──
for path, old_line, new_line in (
    (pkg,    f'"version": "{old}"', f'"version": "{new}"'),
    (tauri,  f'"version": "{old}"', f'"version": "{new}"'),
):
    p = pathlib.Path(path)
    text = p.read_text(encoding="utf-8")
    assert text.count(old_line) == 1, f"{path} 中 {old_line!r} 不唯一或缺失"
    p.write_text(text.replace(old_line, new_line), encoding="utf-8")

# ── Cargo.toml:仅 [package] 段内的版本行 ──
p = pathlib.Path(cargo)
lines, inside, done, out = p.read_text(encoding="utf-8").splitlines(keepends=True), False, False, []
for ln in lines:
    if ln.startswith("["):
        inside = ln.rstrip("\n") == "[package]"
    if inside and not done and ln.rstrip("\n") == f'version = "{old}"':
        ln, done = f'version = "{new}"\n', True
    out.append(ln)
assert done, f"{cargo} 的 [package] 段中未找到 version = \"{old}\""
p.write_text("".join(out), encoding="utf-8")

# ── CHANGELOG:「## 未发布」段改题为版本段,顶部补新空段 ──
p = pathlib.Path(changelog)
text = p.read_text(encoding="utf-8")
marker = "## 未发布"
assert marker in text, "CHANGELOG 缺少「## 未发布」段 —— 请先补上再发版。"
head, rest = text.split(marker, 1)
body_start = 0
next_h = rest.find("\n## ")
assert next_h > 0, "CHANGELOG「未发布」段之后找不到下一个版本段。"
body = rest[body_start:next_h].strip("\n")
assert body and body not in ("(无)", "(待积累)"), \
    "CHANGELOG「未发布」段为空 —— 请先记录本次变更内容再发版。"
text = head + marker + "\n\n(无)\n\n" + f"## {new} — {today}\n\n{body}\n\n" + rest[next_h + 1:]
p.write_text(text, encoding="utf-8")
PYEOF

# cargo check 顺便验证编译;lock 的版本记录随之刷新。
cargo check --workspace --quiet 2>/dev/null

# 复核:三处 == NEW,且 Cargo.lock 确实被刷新(版本变化必然产生 diff)。
# 注:lock 里 zhuye-* 是 submodule 自带版本(上游口径),不参与本仓一致性判断。
versions_consistent || die "bump 后版本复核失败(期望全部 $NEW)。"
[ "$(pkg_version)" = "$NEW" ] || die "package.json 复核失败。"
git -C "$ROOT" diff --quiet -- Cargo.lock \
  && die "Cargo.lock 未被刷新 —— 请手动执行 cargo check --workspace 后重试。"

# ── 4. 本地静态门禁(与 release gate 同一套检查)--------------------------
( cd "$ROOT" && bash tests/static/run.sh ) \
  || die "静态门禁未过 —— 修完再发版(release gate 跑的是同一套)。"

# ── 5. 提交 + 打 tag ------------------------------------------------------
git -C "$ROOT" add "$PKG_JSON" "$CARGO_TOML" "$TAURI_CONF" Cargo.lock "$CHANGELOG"
git -C "$ROOT" commit -m "chore(release): v$NEW —— 版本 bump 与 CHANGELOG 转正"
git -C "$ROOT" tag -a "v$NEW" -m "烛夜桌面 v$NEW(Tauri GUI)"
echo
echo "✓ 版本已提交,tag v$NEW 已创建。"

# ── 6. 推送 --------------------------------------------------------------
if $NO_PUSH; then
  echo "(--no-push)未推送。后续手动执行:"
  echo "  git push origin main v$NEW"
  exit 0
fi

echo
echo "⚠️  推送 v$NEW 将触发正式发布:"
echo "   - release.yml → release gate 全绿后四平台安装包发 GitHub Release(公开)"
if ! $ASSUME_YES; then
  read -r -p "确认推送?输入 yes 继续:" ans
  [ "$ans" = "yes" ] || { echo "已取消(tag 与版本提交保留在本地,未推送)。"; exit 1; }
fi
git -C "$ROOT" push origin main "v$NEW"
echo "tag v$NEW 已推送,发布流水线已触发(可在 Actions 页查看进度)。"
echo "发布成功后把 develop 快进到 main:git push origin main:develop"
