#!/bin/bash
set -e

# Use mounted workspace directory if present, else fallback
TARGET_DIR="${WORKSPACE:-/workspace}"
mkdir -p "$TARGET_DIR"
cd "$TARGET_DIR"

# Launch MCP server in foreground over stdio
# server.py manages the persistent R daemon lifecycle and ensures clean shutdown on SIGTERM/SIGINT
exec python3 /app/server.py
