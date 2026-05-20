# PIX Integration Service - Deployment Guide

## Overview

This guide covers the deployment of the PIX Integration Service with PostgreSQL database and JWT authentication.

---

## Prerequisites

- Python 3.9+
- PostgreSQL 12+
- pip3
- Virtual environment (recommended)

---

## Step 1: Database Setup

### Install PostgreSQL

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# macOS
brew install postgresql

# Start PostgreSQL service
sudo systemctl start postgresql  # Linux
brew services start postgresql   # macOS
```

### Create Database and User

```bash
# Connect to PostgreSQL as postgres user
sudo -u postgres psql

# In PostgreSQL shell:
CREATE DATABASE pix_integration_db;
CREATE USER pix_user WITH ENCRYPTED PASSWORD 'pix_password';
GRANT ALL PRIVILEGES ON DATABASE pix_integration_db TO pix_user;
\q
```

---

## Step 2: Environment Configuration

### Create .env File

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your values
nano .env
```

### Required Environment Variables

```bash
# CRITICAL: Set these in production!
JWT_SECRET_KEY=your-super-secret-jwt-key-here
DATABASE_URL=postgresql://pix_user:pix_password@localhost:5432/pix_integration_db
ENVIRONMENT=production

# Optional: Customize these
ACCESS_TOKEN_EXPIRE_MINUTES=30
MAX_LOGIN_ATTEMPTS=5
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com
```

### Generate Secure JWT Secret

```bash
# Generate a secure random secret
python3 -c "import secrets; print(secrets.token_urlsafe(32))"

# Copy the output and set it as JWT_SECRET_KEY in .env
```

---

## Step 3: Install Dependencies

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements_auth.txt

# Additional dependencies
pip install sqlalchemy psycopg2-binary alembic
```

---

## Step 4: Initialize Database

### Create Tables and Seed Users

```bash
# Run database initialization script
python3 init_db.py
```

This will:
- Create all database tables (users, pix_keys, pix_charges, pix_transactions)
- Seed initial users (admin, pix_operator, user1, demo)

### Default Credentials

| Username | Password | Roles |
|----------|----------|-------|
| admin | admin123 | admin, user, pix_operator |
| pix_operator | operator123 | pix_operator, user |
| user1 | user123 | user |
| demo | demo123 | user |

⚠️ **IMPORTANT**: Change these passwords immediately in production!

---

## Step 5: Run the Application

### Development Mode

```bash
# Run with uvicorn
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Production Mode

```bash
# Run with gunicorn + uvicorn workers
gunicorn main:app \
  --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --access-logfile - \
  --error-logfile -
```

---

## Step 6: Verify Deployment

### Test Authentication

```bash
# Login with admin credentials
curl -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=admin&password=admin123"

# Response should include access_token
```

### Test Protected Endpoint

```bash
# Get access token from login response
TOKEN="your-access-token-here"

# Test protected endpoint
curl -X GET http://localhost:8000/api/v1/pix/keys/user/1 \
  -H "Authorization: Bearer $TOKEN"
```

---

## Step 7: Production Hardening

### 1. Change Default Passwords

```bash
# Connect to database
psql postgresql://pix_user:pix_password@localhost:5432/pix_integration_db

# Update admin password
UPDATE users SET hashed_password = 'new-bcrypt-hash' WHERE username = 'admin';
```

Or use the API:

```python
from auth import get_password_hash

new_hash = get_password_hash("new-secure-password")
print(new_hash)  # Use this in UPDATE query
```

### 2. Enable HTTPS

```bash
# Use nginx as reverse proxy with SSL
sudo apt install nginx certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com
```

### 3. Configure Firewall

```bash
# Allow only necessary ports
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### 4. Set Up Process Manager

```bash
# Install supervisor
sudo apt install supervisor

# Create supervisor config
sudo nano /etc/supervisor/conf.d/pix-integration.conf
```

```ini
[program:pix-integration]
command=/path/to/venv/bin/gunicorn main:app --workers 4 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
directory=/path/to/pix-integration
user=www-data
autostart=true
autorestart=true
stderr_logfile=/var/log/pix-integration/err.log
stdout_logfile=/var/log/pix-integration/out.log
```

```bash
# Start service
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl start pix-integration
```

---

## Step 8: Monitoring and Logging

### Set Up Logging

```python
# In main.py, add:
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/var/log/pix-integration/app.log'),
        logging.StreamHandler()
    ]
)
```

### Monitor Database

```bash
# Check active connections
psql -U pix_user -d pix_integration_db -c "SELECT count(*) FROM pg_stat_activity;"

# Check table sizes
psql -U pix_user -d pix_integration_db -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

---

## Step 9: Backup Strategy

### Database Backups

```bash
# Create backup script
cat > /usr/local/bin/backup-pix-db.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/var/backups/pix-integration"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

pg_dump -U pix_user pix_integration_db | gzip > $BACKUP_DIR/pix_db_$DATE.sql.gz

# Keep only last 30 days
find $BACKUP_DIR -name "pix_db_*.sql.gz" -mtime +30 -delete
EOF

chmod +x /usr/local/bin/backup-pix-db.sh

# Schedule daily backups
crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-pix-db.sh
```

---

## Step 10: Health Checks

### Create Health Check Endpoint

```python
# Add to main.py
@app.get("/health")
async def health_check(db: Session = Depends(get_db)):
    try:
        # Check database connection
        db.execute("SELECT 1")
        return {
            "status": "healthy",
            "database": "connected",
            "timestamp": datetime.utcnow()
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "disconnected",
            "error": str(e),
            "timestamp": datetime.utcnow()
        }
```

### Monitor Health

```bash
# Check health
curl http://localhost:8000/health

# Set up monitoring (e.g., with cron)
*/5 * * * * curl -f http://localhost:8000/health || echo "PIX service is down!" | mail -s "Alert" admin@example.com
```

---

## Troubleshooting

### Database Connection Issues

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Check connection
psql postgresql://pix_user:pix_password@localhost:5432/pix_integration_db

# Check logs
sudo tail -f /var/log/postgresql/postgresql-*.log
```

### JWT Token Issues

```bash
# Verify JWT_SECRET_KEY is set
python3 -c "from config import settings; print(settings.SECRET_KEY)"

# Should NOT be "dev-secret-key-change-in-production" in production
```

### Permission Issues

```bash
# Grant database permissions
sudo -u postgres psql
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO pix_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO pix_user;
```

---

## Security Checklist

- [ ] JWT_SECRET_KEY set to secure random value
- [ ] DATABASE_URL uses strong password
- [ ] Default user passwords changed
- [ ] HTTPS enabled
- [ ] Firewall configured
- [ ] CORS origins restricted
- [ ] DEBUG mode disabled in production
- [ ] Database backups scheduled
- [ ] Monitoring and alerting configured
- [ ] Logs properly configured
- [ ] Process manager (supervisor) running
- [ ] Rate limiting enabled (optional)
- [ ] Email verification enabled (optional)

---

## Next Steps

1. Integrate with real BACEN PIX API
2. Set up email service for verification
3. Implement rate limiting
4. Add comprehensive unit and integration tests
5. Set up CI/CD pipeline
6. Configure monitoring (Prometheus, Grafana)
7. Implement audit logging
8. Add webhook signature verification

---

## Support

For issues or questions:
- Check logs: `/var/log/pix-integration/`
- Review documentation: `AUTHENTICATION.md`
- Database status: `psql -U pix_user -d pix_integration_db`

---

**Deployment Date**: November 1, 2024  
**Version**: 2.0.0  
**Status**: Production Ready ✅
