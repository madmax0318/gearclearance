#!/bin/sh
# Render and install user units from a private stash.env. Placeholders only in git.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
UNIT_SRC="$ROOT/ops/runner/systemd"
SYSTEM=0
MODE=install
LIVE_JOB=
DRY_JOB=
UPDATE_SHA=
RENDER_DIR=${STASH_RENDER_DIR:-}

usage() {
  echo "usage: install.sh [--check|--uninstall|--update <sha>|--enable-watch|--live <job>|--dry-run <job>|--system]" >&2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --system) SYSTEM=1; shift ;;
    --check) MODE=check; shift ;;
    --uninstall) MODE=uninstall; shift ;;
    --enable-watch) MODE=enable-watch; shift ;;
    --update) MODE=update; UPDATE_SHA=${2:?}; shift 2 ;;
    --ref) INSTALL_REF=${2:?}; shift 2 ;;
    --live) MODE=live; LIVE_JOB=${2:?}; shift 2 ;;
    --dry-run) MODE=dry-run; DRY_JOB=${2:?}; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

if [ "$(id -u)" -eq 0 ] && [ "$SYSTEM" -ne 1 ]; then
  echo "refusing root" >&2
  exit 1
fi

load_env() {
  file=$1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
    esac
    key=${line%%=*}
    value=${line#*=}
    case "$value" in
      \"*) value=${value#\"}; value=${value%\"} ;;
      \'*) value=${value#\'}; value=${value%\'} ;;
    esac
    case "$key" in
      *[!A-Za-z0-9_]*) echo "bad env key" >&2; exit 2 ;;
    esac
    export "$key=$value"
  done < "$file"
}

ENV_FILE=${STASH_ENV:-}
if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
  load_env "$ENV_FILE"
fi

to_minutes() {
  hour=${1%%:*}
  minute=${1##*:}
  echo $((10#$hour * 60 + 10#$minute))
}

window_contains() {
  start=$1
  end=$2
  point=$3
  if [ "$start" -le "$end" ]; then
    [ "$point" -ge "$start" ] && [ "$point" -lt "$end" ]
  else
    [ "$point" -ge "$start" ] || [ "$point" -lt "$end" ]
  fi
}

blackout_conflict() {
  calendars="ONCALENDAR_WATCH ONCALENDAR_WATCH_PROMOTE ONCALENDAR_PREPPINGDEALS ONCALENDAR_AIM ONCALENDAR_EXPIRY"
  for key in $calendars; do
    eval "cal=\${$key:-}"
    [ -n "$cal" ] || continue
    cal_day=${cal%% *}
    cal_clock=${cal##* }
    point=$(to_minutes "$cal_clock")
    old_ifs=$IFS
    IFS=';'
    set -f
    for window in ${BLACKOUT_WINDOWS:-}; do
      win_day=${window%% *}
      span=${window##* }
      start=${span%%-*}
      end=${span##*-}
      if [ "$win_day" != "daily" ] && [ "$cal_day" != "daily" ] && [ "$win_day" != "$cal_day" ]; then
        continue
      fi
      if window_contains "$(to_minutes "$start")" "$(to_minutes "$end")" "$point"; then
        set +f
        IFS=$old_ifs
        echo "blackout overlap: $key $cal" >&2
        return 1
      fi
    done
    set +f
    IFS=$old_ifs
  done
  return 0
}

known_cred() {
  case "$1" in
    CRED_GH|CRED_GMAIL|CRED_DRIVE) return 0 ;;
    *) return 1 ;;
  esac
}

refuse_egress() {
  if [ "${DRIVE_UPLOADER:-}" = "rclone" ] && [ -z "${G_EGRESS_DECISION:-}" ]; then
    echo "refusing rclone uploader" >&2
    exit 1
  fi
  shorteners=$(sed -n 's/.*"watch_shorteners"[[:space:]]*:[[:space:]]*\[\(.*\)\].*/\1/p' "$ROOT/pipeline/config/fetch-allowlist.json" | head -n 1)
  case "$shorteners" in
    ""|" ") ;;
    *)
      if [ -z "${G_EGRESS_DECISION:-}" ]; then
        echo "refusing watch shorteners" >&2
        exit 1
      fi
      ;;
  esac
  if [ -n "$ENV_FILE" ]; then
    for key in $(sed -n 's/^\(CRED_[A-Z0-9_]*\)=.*/\1/p' "$ENV_FILE"); do
      if ! known_cred "$key" && [ -z "${G_EGRESS_DECISION:-}" ]; then
        echo "refusing credential id $key" >&2
        exit 1
      fi
    done
  fi
}

check_cred_dir() {
  if [ -z "${CRED_DIR:-}" ] || [ ! -d "$CRED_DIR" ]; then
    return 0
  fi
  mode=$(stat -c %a "$CRED_DIR")
  if [ "$mode" != "700" ]; then
    echo "credential directory mode $mode" >&2
    exit 1
  fi
}

render_units() {
  dest=${1:?}
  mkdir -p "$dest"
  for src in "$UNIT_SRC"/*; do
    name=$(basename "$src" .in)
    calendar=@ONCALENDAR@
    case "$name" in
      stash-deals-watch.timer) calendar=${ONCALENDAR_WATCH:-@ONCALENDAR@} ;;
      stash-deals-watch-promote.timer) calendar=${ONCALENDAR_WATCH_PROMOTE:-@ONCALENDAR@} ;;
      stash-deals-preppingdeals.timer) calendar=${ONCALENDAR_PREPPINGDEALS:-@ONCALENDAR@} ;;
      stash-deals-aim.timer) calendar=${ONCALENDAR_AIM:-@ONCALENDAR@} ;;
      stash-deals-expiry.timer) calendar=${ONCALENDAR_EXPIRY:-@ONCALENDAR@} ;;
    esac
    dry=${STASH_DRY_RUN:-1}
    sed \
      -e "s|@ONCALENDAR@|$calendar|g" \
      -e "s|@CRED_GH@|${CRED_GH:-}|g" \
      -e "s|@CRED_GMAIL@|${CRED_GMAIL:-}|g" \
      -e "s|@CRED_DRIVE@|${CRED_DRIVE:-}|g" \
      -e "s|@NODE@|${NODE:-}|g" \
      -e "s|@CHECKOUT@|${CHECKOUT:-}|g" \
      -e "s|@STASH_ENV@|${STASH_ENV_PATH:-$ENV_FILE}|g" \
      -e "s|STASH_DRY_RUN=1|STASH_DRY_RUN=$dry|g" \
      "$src" > "$dest/$name"
  done
}

directive_checklist() {
  for src in "$UNIT_SRC"/*.service.in; do
    while IFS= read -r word; do
      if ! grep -F -q "$word" "$src"; then
        echo "missing $word in $(basename "$src")" >&2
        return 1
      fi
    done <<'EOF'
NoNewPrivileges=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
SystemCallFilter=@system-service
SystemCallArchitectures=native
LockPersonality=yes
UMask=0077
StateDirectory=stash-deals
StateDirectoryMode=0700
EOF
    while IFS= read -r word; do
      if grep -F -q "$word" "$src"; then
        echo "forbidden $word in $(basename "$src")" >&2
        return 1
      fi
    done <<'EOF'
IPAddressDeny=
SocketBindDeny=
PrivateTmp=
ProtectSystem=
ProtectHome=
MemoryDenyWriteExecute=
EOF
    echo "ok $(basename "$src")"
  done
  for src in "$UNIT_SRC"/*.timer.in; do
    grep -q "AccuracySec=30s" "$src"
    grep -q "Persistent=false" "$src"
    echo "ok $(basename "$src")"
  done
}

verify_git() {
  ref=${1:?}
  head=$(git -C "$ROOT" rev-parse HEAD)
  if [ "$head" != "$ref" ]; then
    echo "HEAD is not $ref" >&2
    exit 1
  fi
  if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
    echo "work tree is dirty" >&2
    exit 1
  fi
  if ! git -C "$ROOT" merge-base --is-ancestor "$ref" origin/main; then
    echo "$ref is not an ancestor of origin/main" >&2
    exit 1
  fi
}

install_deps() {
  npm ci --prefix "$ROOT/pipeline" --ignore-scripts
  npm rebuild better-sqlite3 --prefix "$ROOT/pipeline"
}

prepare_data_git() {
  dest=${DATA_GIT:-$ROOT/data.git}
  if [ ! -d "$dest" ]; then
    git init --bare "$dest"
  fi
  git --git-dir="$dest" config core.hooksPath /dev/null
}

run_check() {
  directive_checklist
  if ! blackout_conflict; then
    exit 1
  fi
  refuse_egress
  check_cred_dir
  if [ -n "$RENDER_DIR" ]; then
    render_units "$RENDER_DIR"
  fi
  echo "NOT ENFORCED (user units)"
  if command -v ss >/dev/null 2>&1; then
    ss -ltunHe 2>/dev/null | grep "uid:$(id -u)" || true
  fi
  deny=${SELF_CHECK_DENYLIST:-}
  if [ -n "$deny" ] && command -v ss >/dev/null 2>&1; then
    if ss -ltunHe 2>/dev/null | grep -F "$deny" >/dev/null; then
      echo "denylist hit" >&2
      exit 1
    fi
  fi
}

case "$MODE" in
  check) run_check ;;
  uninstall)
    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user disable --now stash-deals-watch.timer stash-deals-watch-promote.timer stash-deals-preppingdeals.timer stash-deals-aim.timer stash-deals-expiry.timer || true
    fi
    ;;
  update)
    verify_git "$UPDATE_SHA"
    install_deps
    ;;
  enable-watch|live|dry-run|install)
    if [ "$MODE" = "install" ] || [ "$MODE" = "live" ] || [ "$MODE" = "dry-run" ]; then
      if [ -n "${INSTALL_REF:-}" ]; then
        verify_git "$INSTALL_REF"
      fi
    fi
    refuse_egress
    check_cred_dir
    if ! blackout_conflict; then
      exit 1
    fi
    install_deps
    prepare_data_git
    unit_home=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
    render_units "$unit_home"
    if [ "$MODE" = "live" ]; then
      sed -i "s/STASH_DRY_RUN=1/STASH_DRY_RUN=0/" "$unit_home/stash-deals-$LIVE_JOB.service" || true
    fi
    if command -v systemd-analyze >/dev/null 2>&1; then
      systemd-analyze --user verify "$unit_home"/stash-deals-*.service || true
    fi
    if command -v systemctl >/dev/null 2>&1; then
      systemctl --user daemon-reload || true
      systemctl --user enable stash-deals-watch.timer stash-deals-watch-promote.timer stash-deals-preppingdeals.timer stash-deals-aim.timer stash-deals-expiry.timer || true
    fi
    ;;
esac
