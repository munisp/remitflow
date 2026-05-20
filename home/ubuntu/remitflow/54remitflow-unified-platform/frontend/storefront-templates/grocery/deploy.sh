#!/bin/bash

# Deploy Fresh Market Template

echo "Deploying Fresh Market..."

# Copy template to storefront
cp -r /home/ubuntu/remittance-platform/frontend/storefront-templates/grocery/* \
      /home/ubuntu/remittance-platform/frontend/agent-storefront/

# Update configuration
cd /home/ubuntu/remittance-platform/frontend/agent-storefront
cat config.json

echo "Template deployed successfully!"
echo "Start your storefront with: ./start_storefront.sh"
