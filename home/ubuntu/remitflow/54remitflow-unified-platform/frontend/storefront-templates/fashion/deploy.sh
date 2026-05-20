#!/bin/bash

# Deploy Afro Chic Boutique Template

echo "Deploying Afro Chic Boutique..."

# Copy template to storefront
cp -r /home/ubuntu/remittance-platform/frontend/storefront-templates/fashion/* \
      /home/ubuntu/remittance-platform/frontend/agent-storefront/

# Update configuration
cd /home/ubuntu/remittance-platform/frontend/agent-storefront
cat config.json

echo "Template deployed successfully!"
echo "Start your storefront with: ./start_storefront.sh"
