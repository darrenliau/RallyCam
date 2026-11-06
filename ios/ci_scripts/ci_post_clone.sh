#!/bin/sh
set -eu
ROOT="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../.." && pwd)}"
exec sh "$ROOT/ci_scripts/ci_post_clone.sh"
