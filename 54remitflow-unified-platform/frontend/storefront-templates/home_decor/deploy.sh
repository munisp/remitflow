#!/bin/bash

# Deploy HomeStyle Decor Template

echo "Deploying HomeStyle Decor..."

# Copy template to storefront
cp -r /home/ubuntu/remittance-platform/frontend/storefront-templates/home_decor/* \
      /home/ubuntu/remittance-platform/frontend/agent-storefront/

# Update configuration
cd /home/ubuntu/remittance-platform/frontend/agent-storefront
cat config.json

echo "Template deployed successfully!"
echo "Start your storefront with: ./start_storefront.sh"
