#!/usr/bin/env bash
# Quick connection test for Pataclaw
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$SCRIPT_DIR/pataclaw.sh" test
