#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
parent_dir="$(dirname "$project_dir")"
archive="$parent_dir/maintai-ops.zip"
cd "$parent_dir"
rm -f "$archive"
zip -rq "$archive" "$(basename "$project_dir")" -x "*/node_modules/*" "*/dist/*" "*/.env" "*/.venv/*" "*/__pycache__/*" "*/.git/*"
echo "$archive"
