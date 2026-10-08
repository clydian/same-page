#!/usr/bin/env bash
set -euo pipefail

# Azure's Ubuntu mirror has stalled CI before tests could start. Retain the
# runner's repositories and signature verification; change only that mirror.
for source in /etc/apt/apt-mirrors.txt /etc/apt/sources.list /etc/apt/sources.list.d/ubuntu.sources; do
  if [ -f "$source" ]; then
    sudo sed -i -E 's|https?://azure.archive.ubuntu.com/ubuntu/?|https://archive.ubuntu.com/ubuntu/|g' "$source"
  fi
done

npx playwright install --with-deps chromium webkit
