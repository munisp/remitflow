#!/bin/bash

# Master Template Deployment Script
# Usage: ./deploy_template.sh <template_name>

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check if template name is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Template name required${NC}"
    echo ""
    echo "Usage: ./deploy_template.sh <template_name>"
    echo ""
    echo "Available templates:"
    echo "  • electronics  - TechHub Store (Electronics & Tech)"
    echo "  • fashion      - Afro Chic Boutique (Fashion & Apparel)"
    echo "  • grocery      - Fresh Market (Groceries & Food)"
    echo "  • pharmacy     - HealthPlus Pharmacy (Healthcare & Medications)"
    echo "  • restaurant   - Mama's Kitchen (Restaurant & Food Delivery)"
    echo "  • beauty       - Glow Beauty Store (Beauty & Cosmetics)"
    echo "  • books        - BookWorm Store (Books & Literature)"
    echo "  • sports       - FitZone Sports (Sports & Fitness)"
    echo "  • home_decor   - HomeStyle Decor (Home & Furniture)"
    echo "  • auto_parts   - AutoPro Parts (Automotive Parts)"
    echo ""
    exit 1
fi

TEMPLATE_NAME=$1
TEMPLATE_DIR="/home/ubuntu/remittance-platform/frontend/storefront-templates/$TEMPLATE_NAME"
STOREFRONT_DIR="/home/ubuntu/remittance-platform/frontend/agent-storefront"

# Check if template exists
if [ ! -d "$TEMPLATE_DIR" ]; then
    echo -e "${RED}Error: Template '$TEMPLATE_NAME' not found${NC}"
    exit 1
fi

echo "======================================"
echo -e "${BLUE}Deploying Template: $TEMPLATE_NAME${NC}"
echo "======================================"
echo ""

# Read template config
TEMPLATE_CONFIG="$TEMPLATE_DIR/config.json"
if [ -f "$TEMPLATE_CONFIG" ]; then
    STORE_NAME=$(cat "$TEMPLATE_CONFIG" | python3 -c "import sys, json; print(json.load(sys.stdin)['name'])")
    echo -e "${GREEN}Store Name: $STORE_NAME${NC}"
fi

echo ""
echo -e "${YELLOW}Step 1/5: Backing up current storefront...${NC}"
BACKUP_DIR="/home/ubuntu/storefront_backups/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
if [ -f "$STOREFRONT_DIR/config.json" ]; then
    cp "$STOREFRONT_DIR/config.json" "$BACKUP_DIR/" 2>/dev/null || true
fi
echo -e "${GREEN}✓ Backup created at: $BACKUP_DIR${NC}"

echo ""
echo -e "${YELLOW}Step 2/5: Copying template files...${NC}"
cp "$TEMPLATE_DIR/config.json" "$STOREFRONT_DIR/"
cp "$TEMPLATE_DIR/products.json" "$STOREFRONT_DIR/"
echo -e "${GREEN}✓ Template files copied${NC}"

echo ""
echo -e "${YELLOW}Step 3/5: Importing sample products...${NC}"
# Import products via API (if backend is running)
if curl -s http://localhost:8000/health > /dev/null 2>&1; then
    echo "  Backend is running, importing products..."
    curl -X POST http://localhost:8000/products/bulk \
         -H "Content-Type: application/json" \
         -d @"$TEMPLATE_DIR/products.json" > /dev/null 2>&1 || true
    echo -e "${GREEN}✓ Products imported${NC}"
else
    echo -e "${YELLOW}⚠ Backend not running, products will be imported on next start${NC}"
fi

echo ""
echo -e "${YELLOW}Step 4/5: Updating environment variables...${NC}"
cat > "$STOREFRONT_DIR/.env.local" << EOF
VITE_STORE_NAME="$STORE_NAME"
VITE_TEMPLATE="$TEMPLATE_NAME"
VITE_API_URL="http://localhost:8000"
VITE_QR_SERVICE_URL="http://localhost:8032"
VITE_COMMUNICATION_URL="http://localhost:8040"
EOF
echo -e "${GREEN}✓ Environment configured${NC}"

echo ""
echo -e "${YELLOW}Step 5/5: Generating template documentation...${NC}"
cp "$TEMPLATE_DIR/README.md" "$STOREFRONT_DIR/TEMPLATE_INFO.md"
echo -e "${GREEN}✓ Documentation generated${NC}"

echo ""
echo "======================================"
echo -e "${GREEN}Template Deployed Successfully!${NC}"
echo "======================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Start the storefront:"
echo -e "   ${BLUE}cd $STOREFRONT_DIR${NC}"
echo -e "   ${BLUE}pnpm run dev${NC}"
echo ""
echo "2. Open in browser:"
echo -e "   ${BLUE}http://localhost:5173${NC}"
echo ""
echo "3. Customize your store:"
echo -e "   ${BLUE}nano config.json${NC}"
echo ""
echo "4. View template info:"
echo -e "   ${BLUE}cat TEMPLATE_INFO.md${NC}"
echo ""
echo "======================================"

