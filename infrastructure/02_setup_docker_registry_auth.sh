#!/bin/bash
set -e

NS=54remit
CONFIG_FILE_LOCATION="./config/docker.json"

# DO_REGISTRY_TOKEN is a DigitalOcean Container Registry API token, used as
# both username and password per DO's docker-config convention (see
# infrastructure/.env.example). Generate one with:
#   doctl registry docker-config --read-write
if [ -z "$DO_REGISTRY_TOKEN" ]; then
  echo "Missing required env var: DO_REGISTRY_TOKEN (see infrastructure/.env.example)" >&2
  exit 1
fi

AUTH_B64=$(printf '%s:%s' "$DO_REGISTRY_TOKEN" "$DO_REGISTRY_TOKEN" | base64 | tr -d '\n')
cat > "$CONFIG_FILE_LOCATION" <<EOF
{"auths":{"registry.digitalocean.com":{"auth":"$AUTH_B64"}}}
EOF

kubectl create secret generic credential \
  --from-file=.dockerconfigjson="$CONFIG_FILE_LOCATION" \
  --type=kubernetes.io/dockerconfigjson \
  --namespace "$NS"

kubectl patch serviceaccount 54remit -p '{"imagePullSecrets": [{"name": "credential"}]}' -n "$NS"
