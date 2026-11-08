#!/bin/sh
# fetch-refs — 把开发本项目时要参考的上游仓库浅克隆到 <项目根>/.tmp/ 下。
#
#   ./scripts/fetch-refs.sh [--force]
#   sh scripts/fetch-refs.sh [--force]
#
# 项目根由 git rev-parse --show-toplevel 求得，所以在任意目录下执行都可以。
# 目录已在 .gitignore 中忽略（.tmp/），不会污染工作区。
# 已存在的仓库走 fetch + 快进合并；--force 删除后重新克隆。

set -eu

# 解析软链，拿到脚本的真实位置（$0 可能指向 /usr/local/bin 之类的软链）
resolve_link() {
  target=$1
  while [ -L "$target" ]; do
    link=$(readlink "$target")
    case "$link" in
      /*) target=$link ;;
      *) target=$(dirname -- "$target")/$link ;;
    esac
  done
  printf '%s\n' "$target"
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$(resolve_link "$0")")" && pwd)

# 项目根优先问 git（从子目录调用、脚本被软链过去都成立），
# 不在 git 工作区内（或没装 git）时退回脚本的上级目录。
if ROOT_DIR=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null); then
  :
else
  ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
fi

TMP_DIR="$ROOT_DIR/.tmp"

FORCE=0
STATUS=0

log() {
  printf '==> %s\n' "$*"
}

warn() {
  printf '!!! %s\n' "$*" >&2
}

usage() {
  cat <<'EOF'
fetch-refs — 把开发本项目时要参考的上游仓库浅克隆到 <项目根>/.tmp/ 下

  ./scripts/fetch-refs.sh [--force]

  无参数      首次克隆；已存在的仓库走 fetch + 快进合并
  -f, --force 删除已有目录后重新克隆

项目根由 git 求得，可在任意目录下执行。
EOF
}

for arg in "$@"; do
  case "$arg" in
    -f | --force) FORCE=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      warn "未知参数：$arg"
      exit 2
      ;;
  esac
done

if ! command -v git >/dev/null 2>&1; then
  warn '未找到 git，请先安装。'
  exit 1
fi

sync_repo() {
  name=$1
  url=$2
  dir="$TMP_DIR/$name"

  if [ "$FORCE" -eq 1 ] && [ -e "$dir" ]; then
    log "删除 $name"
    rm -rf "$dir"
  fi

  if [ -d "$dir/.git" ]; then
    log "更新 $name"
    if ! git -C "$dir" fetch --depth 1 --quiet origin; then
      warn "$name 拉取失败（可用 --force 重新克隆）"
      STATUS=1
      return 0
    fi
    if ! git -C "$dir" merge --ff-only --quiet FETCH_HEAD; then
      warn "$name 有本地改动或已分叉，未更新（可用 --force 重新克隆）"
      STATUS=1
    fi
    return 0
  fi

  if [ -e "$dir" ]; then
    warn "$dir 已存在但不是 git 仓库，跳过（可用 --force 删除后重新克隆）"
    STATUS=1
    return 0
  fi

  log "克隆 $name"
  if ! git clone --depth 1 --quiet "$url" "$dir"; then
    warn "$name 克隆失败：$url"
    STATUS=1
  fi
}

mkdir -p "$TMP_DIR"

sync_repo deepseek-harness https://github.com/deepseek-ai/deepseek-harness
sync_repo DSH-better-sidebar https://github.com/omdsh-dev/DSH-better-sidebar
sync_repo embedded-mcp-toolkit https://cnb.cool/smk.h/embedded-mcp-toolkit

printf '\n参考仓库位于：%s\n' "$TMP_DIR"
exit "$STATUS"
