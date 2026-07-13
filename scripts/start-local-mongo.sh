#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Start the local MongoDB server (cloned from Atlas sandbox, 2026-05-15).
#
# Usage:
#   bash scripts/start-local-mongo.sh          # start
#   bash scripts/start-local-mongo.sh stop     # stop
#   bash scripts/start-local-mongo.sh status   # show status
#   bash scripts/start-local-mongo.sh resync   # re-dump Atlas → local
#
# After starting, set MONGO_URI in .env to:
#   MONGO_URI=mongodb://localhost:27017/staff_inventory
# ─────────────────────────────────────────────────────────────────────────────

set -e

MONGOD="/tmp/mongodb-macos-aarch64-8.0.9/bin/mongod"
MONGODUMP="/tmp/mongodb-tools/mongodb-database-tools-macos-arm64-100.12.0/bin/mongodump"
MONGORESTORE="/tmp/mongodb-tools/mongodb-database-tools-macos-arm64-100.12.0/bin/mongorestore"
ATLAS_URI="${ATLAS_URI:?Set ATLAS_URI in env before running (e.g. export ATLAS_URI=mongodb+srv://...)}"
LOCAL_URI="mongodb://localhost:27017/staff_inventory"
DBPATH="$HOME/data/db"
LOGPATH="$HOME/data/log/mongod.log"
PORT=27017

mkdir -p "$DBPATH" "$HOME/data/log"

cmd="${1:-start}"

case "$cmd" in
  start)
    if pgrep -x mongod >/dev/null 2>&1; then
      echo "✅  MongoDB is already running on port $PORT"
    else
      echo "🚀  Starting local MongoDB on port $PORT..."
      "$MONGOD" --dbpath "$DBPATH" --logpath "$LOGPATH" --fork --port "$PORT"
      echo "✅  MongoDB started  (log: $LOGPATH)"
    fi
    echo ""
    echo "Local URI:  $LOCAL_URI"
    echo "To use it, set in .env:"
    echo "  MONGO_URI=$LOCAL_URI"
    ;;

  stop)
    echo "🛑  Stopping local MongoDB..."
    pkill mongod && echo "✅  Stopped" || echo "⚠️  No mongod process found"
    ;;

  status)
    if pgrep -x mongod >/dev/null 2>&1; then
      echo "✅  MongoDB is running on port $PORT"
    else
      echo "❌  MongoDB is NOT running"
    fi
    ;;

  resync)
    echo "🔄  Re-syncing from Atlas → local..."
    echo "    Dumping from Atlas..."
    "$MONGODUMP" --uri="$ATLAS_URI" --out=/tmp/atlas_dump --gzip
    echo "    Restoring to local..."
    "$MONGORESTORE" \
      --uri="mongodb://localhost:$PORT" \
      --nsInclude="staff_inventory.*" \
      --drop \
      --gzip \
      /tmp/atlas_dump
    echo "✅  Resync complete"
    ;;

  *)
    echo "Usage: $0 {start|stop|status|resync}"
    exit 1
    ;;
esac
