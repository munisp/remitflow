#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# kafka-start.sh — RemitFlow v98.3
#
# Starts the local Kafka KRaft broker and Kafka UI using Docker Compose.
# Polls until the broker is healthy, then prints the Kafka UI URL.
#
# Usage:
#   chmod +x scripts/kafka-start.sh
#   ./scripts/kafka-start.sh
#
# Requirements:
#   - Docker and Docker Compose installed
#   - Port 9092 (Kafka) and 8080 (Kafka UI) available
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
KAFKA_SERVICE="kafka"
KAFKA_UI_SERVICE="kafka-ui"
KAFKA_HOST="${KAFKA_HOST:-localhost}"
KAFKA_PORT="${KAFKA_PORT:-9092}"
KAFKA_UI_PORT="${KAFKA_UI_PORT:-8080}"
MAX_WAIT="${MAX_WAIT:-60}"

echo "🚀 Starting Kafka KRaft broker and Kafka UI..."
echo "   Compose file: ${COMPOSE_FILE}"
echo "   Kafka:        ${KAFKA_HOST}:${KAFKA_PORT}"
echo "   Kafka UI:     http://${KAFKA_HOST}:${KAFKA_UI_PORT}"
echo ""

# Start the services
docker compose -f "${COMPOSE_FILE}" up -d "${KAFKA_SERVICE}" "${KAFKA_UI_SERVICE}"

echo ""
echo "⏳ Waiting for Kafka broker to be ready (max ${MAX_WAIT}s)..."

elapsed=0
while true; do
  if docker compose -f "${COMPOSE_FILE}" exec -T "${KAFKA_SERVICE}" \
      kafka-topics.sh --bootstrap-server "${KAFKA_HOST}:${KAFKA_PORT}" --list > /dev/null 2>&1; then
    echo "✅ Kafka broker is ready!"
    break
  fi

  if [ "${elapsed}" -ge "${MAX_WAIT}" ]; then
    echo "❌ Kafka broker did not become ready within ${MAX_WAIT}s"
    echo "   Check logs: docker compose logs ${KAFKA_SERVICE}"
    exit 1
  fi

  sleep 2
  elapsed=$((elapsed + 2))
  echo "   Waiting... ${elapsed}s / ${MAX_WAIT}s"
done

echo ""
echo "📊 Kafka UI:  http://${KAFKA_HOST}:${KAFKA_UI_PORT}"
echo "🔗 Broker:    ${KAFKA_HOST}:${KAFKA_PORT}"
echo ""
echo "💡 RemitFlow will automatically connect to the broker."
echo "   The Kafka Dashboard at /admin/kafka will show live metrics."
echo ""
echo "📌 Useful commands:"
echo "   docker compose logs -f ${KAFKA_SERVICE}    # Follow broker logs"
echo "   docker compose stop ${KAFKA_SERVICE}       # Stop broker"
echo "   docker compose down                        # Stop all services"
