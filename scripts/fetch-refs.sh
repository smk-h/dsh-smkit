#!/bin/sh
# fetch-refs — 把开发本项目时要参考的上游仓库克隆到 <项目根>/.tmp/ 下。
#
#   ./scripts/fetch-refs.sh [--force]
#   sh scripts/fetch-refs.sh [--force]
#
# 项目根由 git rev-parse --show-toplevel 求得，所以在任意目录下执行都可以。
# 目录已在 .gitignore 中忽略（.tmp/），不会污染工作区。
# 默认浅克隆（--depth 1），只看语法时够用；要看提交记录、比对历史版本的仓库
# 在下面的调用里加 full，脚本会凭已有目录判断是否补全历史（--unshallow）。
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

默认浅克隆（--depth 1）；脚本里标了 full 的仓库取完整历史，已有浅克隆会被
自动补全（--unshallow），不必先删目录。

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

# sync_repo <名字> <url> [full]
#
# 默认浅克隆；第三个参数给 full 表示这个仓库要完整历史——它既用于首次克隆，
# 也用于把一个已存在的浅克隆补全（--unshallow），所以老目录不用 --force 重建。
sync_repo() {
  name=$1
  url=$2
  mode=${3:-shallow}
  dir="$TMP_DIR/$name"

  if [ "$FORCE" -eq 1 ] && [ -e "$dir" ]; then
    log "删除 $name"
    rm -rf "$dir"
  fi

  if [ -d "$dir/.git" ]; then
    log "更新 $name"
    if [ "$mode" = full ] && [ "$(git -C "$dir" rev-parse --is-shallow-repository)" = true ]; then
      log "补全 $name 的提交历史"
      fetch_args="--unshallow --quiet origin"
    elif [ "$mode" = full ]; then
      fetch_args="--quiet origin"
    else
      fetch_args="--depth 1 --quiet origin"
    fi
    if ! git -C "$dir" fetch $fetch_args; then
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
  if [ "$mode" = full ]; then
    clone_args="--quiet"
  else
    clone_args="--depth 1 --quiet"
  fi
  if ! git clone $clone_args "$url" "$dir"; then
    warn "$name 克隆失败：$url"
    STATUS=1
  fi
}

mkdir -p "$TMP_DIR"

sync_repo deepseek-harness https://github.com/deepseek-ai/deepseek-harness
sync_repo DSH-better-sidebar https://github.com/omdsh-dev/DSH-better-sidebar
sync_repo embedded-mcp-toolkit https://cnb.cool/smk.h/embedded-mcp-toolkit
# 上游实现要对着提交记录读，取完整历史。
sync_repo dsh-mcp-manager https://github.com/hyqhyq3/dsh-mcp-manager.git full

printf '\n参考仓库位于：%s\n' "$TMP_DIR"
exit "$STATUS"
