#!/usr/bin/env bash
set -euo pipefail

NAME="$1"
if [ -z "$NAME" ]; then
  echo "Usage: $0 NAME" >&2
  exit 1
fi

greet() {
  local message="Hello, $1!"
  echo "$message"
}

for item in alpha beta gamma; do
  if [ "$item" = "alpha" ]; then
    greet "$item"
  else
    echo "skip: $item"
  fi
done

case "$NAME" in
  alpha) echo "first" ;;
  beta | gamma) echo "second or third" ;;
  *) echo "unknown" ;;
esac

results=$(find . -name '*.sh' | sort | wc -l)
echo "found $results scripts"
