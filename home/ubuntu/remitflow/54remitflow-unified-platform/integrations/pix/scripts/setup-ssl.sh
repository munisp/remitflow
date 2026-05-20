#!/bin/bash
#
# SSL/HTTPS Setup Script for PIX Integration Service
# This script automates the setup of Let's Encrypt SSL certificates
#
# Usage: sudo ./setup-ssl.sh yourdomain.com your@email.com
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Error: This script must be run as root${NC}"
    echo "Usage: sudo ./setup-ssl.sh yourdomain.com your@email.com"
    exit 1
fi

# Check arguments
if [ "$#" -ne 2 ]; then
    echo -e "${RED}Error: Invalid arguments${NC}"
    echo "Usage: sudo ./setup-ssl.sh yourdomain.com your@email.com"
    echo "Example: sudo ./setup-ssl.sh pix.example.com admin@example.com"
    exit 1
fi

DOMAIN=$1
EMAIL=$2

echo -e "${GREEN}=== PIX Integration Service - SSL Setup ===${NC}"
echo "Domain: $DOMAIN"
echo "Email: $EMAIL"
echo ""

# Step 1: Install Certbot
echo -e "${YELLOW}Step 1: Installing Certbot...${NC}"
apt update
apt install -y certbot python3-certbot-nginx

# Step 2: Install Nginx if not installed
echo -e "${YELLOW}Step 2: Checking Nginx installation...${NC}"
if ! command -v nginx &> /dev/null; then
    echo "Installing Nginx..."
    apt install -y nginx
else
    echo "Nginx is already installed"
fi

# Step 3: Create directory for ACME challenge
echo -e "${YELLOW}Step 3: Creating directories...${NC}"
mkdir -p /var/www/certbot
mkdir -p /var/log/nginx

# Step 4: Copy Nginx configuration
echo -e "${YELLOW}Step 4: Setting up Nginx configuration...${NC}"

# Update domain in nginx config
NGINX_CONFIG="/etc/nginx/sites-available/pix-integration.conf"
cp ../nginx/pix-integration.conf $NGINX_CONFIG

# Replace yourdomain.com with actual domain
sed -i "s/yourdomain.com/$DOMAIN/g" $NGINX_CONFIG

# Create symlink if it doesn't exist
if [ ! -L "/etc/nginx/sites-enabled/pix-integration.conf" ]; then
    ln -s $NGINX_CONFIG /etc/nginx/sites-enabled/pix-integration.conf
fi

# Remove default nginx site if exists
if [ -L "/etc/nginx/sites-enabled/default" ]; then
    rm /etc/nginx/sites-enabled/default
fi

# Step 5: Test Nginx configuration
echo -e "${YELLOW}Step 5: Testing Nginx configuration...${NC}"
nginx -t

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Nginx configuration test failed${NC}"
    exit 1
fi

# Step 6: Reload Nginx
echo -e "${YELLOW}Step 6: Reloading Nginx...${NC}"
systemctl reload nginx

# Step 7: Obtain SSL certificate
echo -e "${YELLOW}Step 7: Obtaining SSL certificate from Let's Encrypt...${NC}"
echo "This may take a few moments..."

certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    -d $DOMAIN \
    -d www.$DOMAIN

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Failed to obtain SSL certificate${NC}"
    echo "Please check:"
    echo "1. DNS records point to this server"
    echo "2. Port 80 is open and accessible"
    echo "3. Domain is valid and reachable"
    exit 1
fi

# Step 8: Update Nginx config with SSL
echo -e "${YELLOW}Step 8: Updating Nginx configuration for HTTPS...${NC}"

# The nginx config already has SSL configuration, just reload
systemctl reload nginx

# Step 9: Set up automatic renewal
echo -e "${YELLOW}Step 9: Setting up automatic certificate renewal...${NC}"

# Test renewal
certbot renew --dry-run

if [ $? -eq 0 ]; then
    echo -e "${GREEN}Certificate renewal test successful${NC}"
    
    # Add cron job for automatic renewal
    CRON_JOB="0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'"
    
    # Check if cron job already exists
    if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
        (crontab -l 2>/dev/null; echo "$CRON_JOB") | crontab -
        echo -e "${GREEN}Automatic renewal cron job added${NC}"
    else
        echo "Cron job for renewal already exists"
    fi
else
    echo -e "${YELLOW}Warning: Certificate renewal test failed${NC}"
fi

# Step 10: Configure firewall
echo -e "${YELLOW}Step 10: Configuring firewall...${NC}"

if command -v ufw &> /dev/null; then
    ufw allow 80/tcp
    ufw allow 443/tcp
    echo -e "${GREEN}Firewall rules updated${NC}"
else
    echo "UFW not installed, skipping firewall configuration"
fi

# Step 11: Verify SSL
echo -e "${YELLOW}Step 11: Verifying SSL configuration...${NC}"

# Check if certificate files exist
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo -e "${GREEN}SSL certificate installed successfully${NC}"
    
    # Show certificate info
    echo ""
    echo "Certificate details:"
    openssl x509 -in /etc/letsencrypt/live/$DOMAIN/fullchain.pem -noout -subject -dates
else
    echo -e "${RED}Error: SSL certificate files not found${NC}"
    exit 1
fi

# Final steps
echo ""
echo -e "${GREEN}=== SSL Setup Complete! ===${NC}"
echo ""
echo "Your PIX Integration Service is now secured with HTTPS!"
echo ""
echo "Next steps:"
echo "1. Update your DNS to point to this server"
echo "2. Test HTTPS access: https://$DOMAIN/health"
echo "3. Test API: https://$DOMAIN/docs"
echo "4. Monitor logs: tail -f /var/log/nginx/pix-integration-access.log"
echo ""
echo "Certificate will auto-renew via cron job at 3 AM daily"
echo ""
echo "SSL Configuration:"
echo "- Certificate: /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
echo "- Private Key: /etc/letsencrypt/live/$DOMAIN/privkey.pem"
echo "- Nginx Config: /etc/nginx/sites-available/pix-integration.conf"
echo ""
echo -e "${GREEN}Setup completed successfully!${NC}"
