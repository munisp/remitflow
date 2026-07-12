#!/bin/bash
set -e

NS=54remit
CHARTS_DIR=./charts
START_FROM="$1"   # optional chart name

STARTED=false

for chart in $(ls -d "$CHARTS_DIR"/* | sort); do
  if [ -d "$chart" ]; then
    RELEASE_NAME=$(basename "$chart")

    # If a start chart is provided, skip until we hit it
    if [ -n "$START_FROM" ] && [ "$STARTED" = false ]; then
      if [ "$RELEASE_NAME" = "$START_FROM" ]; then
        STARTED=true
      else
        echo "Skipping chart: $RELEASE_NAME"
        continue
      fi
    fi

    echo "Deploying chart: $RELEASE_NAME"

    helm upgrade --install "$RELEASE_NAME" \
      "$chart" \
      -n "$NS" \
      --create-namespace
  fi
done
