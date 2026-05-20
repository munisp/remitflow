# IT Operations Runbook - Grafana Monitoring Stack
## Remittance Platform - Ansible Automation Guide

**Version:** 1.0  
**Last Updated:** October 29, 2025  
**Maintained By:** DevOps Team  
**On-Call:** See PagerDuty rotation

---

## 📋 Table of Contents

1. [Quick Reference](#quick-reference)
2. [Daily Operations](#daily-operations)
3. [Weekly Tasks](#weekly-tasks)
4. [Deployment Procedures](#deployment-procedures)
5. [Troubleshooting Guide](#troubleshooting-guide)
6. [Incident Response](#incident-response)
7. [Rollback Procedures](#rollback-procedures)
8. [Maintenance Tasks](#maintenance-tasks)
9. [Emergency Contacts](#emergency-contacts)

---

## 🚀 Quick Reference

### **Common Commands**

```bash
# Check service status
ansible monitoring -i inventories/production -m systemd -a "name=grafana-server" -b

# Deploy to staging
ansible-playbook -i inventories/staging playbooks/deploy-monitoring.yml

# Deploy to production
ansible-playbook -i inventories/production playbooks/deploy-monitoring.yml

# Run health checks
ansible-playbook -i inventories/production playbooks/ci-cd-deploy.yml --tags healthcheck

# Rollback
ansible-playbook -i inventories/production playbooks/ci-cd-deploy.yml --tags rollback

# View logs
ansible monitoring -i inventories/production -m shell -a "journalctl -u grafana-server -n 100" -b
```

### **Important URLs**

| Environment | Grafana | Prometheus | AlertManager |
|-------------|---------|------------|--------------|
| **Production** | https://monitoring.remittance-platform.com | https://prometheus.remittance-platform.com | https://alerts.remittance-platform.com |
| **Staging** | https://staging-monitoring.remittance-platform.com | http://staging-prometheus:9090 | http://staging-alerts:9093 |

### **Credentials**

| System | Username | Password Location |
|--------|----------|-------------------|
| Grafana | admin | 1Password: "Grafana Admin" |
| SSH | ubuntu | ~/.ssh/id_rsa |
| Vault | - | ANSIBLE_VAULT_PASSWORD env var |

---

## 📅 Daily Operations

### **Morning Health Check (15 minutes)**

**Objective:** Verify all monitoring services are healthy

#### **Step 1: Check Service Status**

```bash
# Navigate to automation directory
cd ~/ansible-grafana-deployment

# Check all services
ansible monitoring -i inventories/production -m shell -a "systemctl status grafana-server prometheus alertmanager" -b
```

**Expected Output:**
```
● grafana-server.service - Grafana instance
   Loaded: loaded
   Active: active (running)

● prometheus.service - Prometheus
   Loaded: loaded
   Active: active (running)

● alertmanager.service - Prometheus Alertmanager
   Loaded: loaded
   Active: active (running)
```

**If any service is not running:**
→ See [Troubleshooting: Service Not Running](#service-not-running)

#### **Step 2: Verify Grafana Dashboards**

```bash
# Check dashboard count
curl -s -u admin:$GRAFANA_ADMIN_PASSWORD \
  https://monitoring.remittance-platform.com/api/search?type=dash-db | \
  jq '. | length'
```

**Expected Output:** `3` (or more)

**If count is less than 3:**
→ See [Troubleshooting: Missing Dashboards](#missing-dashboards)

#### **Step 3: Check Prometheus Targets**

```bash
# Check target health
curl -s https://prometheus.remittance-platform.com/api/v1/targets | \
  jq '.data.activeTargets[] | select(.health != "up") | {job: .labels.job, health: .health}'
```

**Expected Output:** Empty (no unhealthy targets)

**If targets are down:**
→ See [Troubleshooting: Prometheus Targets Down](#prometheus-targets-down)

#### **Step 4: Verify AlertManager**

```bash
# Check for firing alerts
curl -s https://alerts.remittance-platform.com/api/v2/alerts | \
  jq '[.[] | select(.status.state == "active")] | length'
```

**Expected Output:** `0` (no active alerts)

**If alerts are firing:**
→ See [Incident Response](#incident-response)

#### **Step 5: Check Disk Space**

```bash
# Check disk usage on monitoring servers
ansible monitoring -i inventories/production -m shell -a "df -h | grep -E '(Filesystem|/var/lib)'" -b
```

**Expected Output:** All partitions < 80% used

**If disk usage > 80%:**
→ See [Maintenance: Disk Cleanup](#disk-cleanup)

#### **Step 6: Review Logs**

```bash
# Check for errors in last hour
ansible monitoring -i inventories/production -m shell \
  -a "journalctl -u grafana-server --since '1 hour ago' | grep -i error | tail -20" -b
```

**Expected Output:** No critical errors

**If errors found:**
→ Document in daily log and investigate

#### **Daily Health Check Checklist**

- [ ] All services running
- [ ] 3+ dashboards loaded
- [ ] All Prometheus targets up
- [ ] No active alerts
- [ ] Disk usage < 80%
- [ ] No critical errors in logs

**Time to Complete:** 10-15 minutes  
**Frequency:** Every morning, 9:00 AM  
**Document:** Log results in #devops-daily Slack channel

---

### **Dashboard Monitoring (Continuous)**

#### **Executive Dashboard Review**

**Access:** https://monitoring.remittance-platform.com/d/executive-dashboard

**Key Metrics to Watch:**

1. **Platform Health Score**
   - ✅ Normal: > 99%
   - ⚠️ Warning: 95-99%
   - 🔴 Critical: < 95%
   - **Action if < 99%:** Investigate service degradation

2. **Active Users (DAU)**
   - ✅ Normal: Growing or stable
   - ⚠️ Warning: 10% drop
   - 🔴 Critical: 20%+ drop
   - **Action if dropping:** Alert product team

3. **Transaction Volume**
   - ✅ Normal: Within expected range
   - ⚠️ Warning: 30% deviation
   - 🔴 Critical: 50%+ deviation
   - **Action if abnormal:** Check payment systems

4. **Crash-Free Rate**
   - ✅ Normal: > 99.5%
   - ⚠️ Warning: 99-99.5%
   - 🔴 Critical: < 99%
   - **Action if < 99.5%:** Alert mobile team

#### **Security Dashboard Review**

**Access:** https://monitoring.remittance-platform.com/d/security-dashboard

**Key Metrics to Watch:**

1. **Security Score**
   - ✅ Normal: 11.0/10.0
   - ⚠️ Warning: 10.0-10.9
   - 🔴 Critical: < 10.0
   - **Action if < 11.0:** Review security logs

2. **Active Security Incidents**
   - ✅ Normal: 0
   - ⚠️ Warning: 1-2
   - 🔴 Critical: 3+
   - **Action if > 0:** Immediate investigation

3. **Failed Authentication Attempts**
   - ✅ Normal: < 100/min
   - ⚠️ Warning: 100-500/min
   - 🔴 Critical: > 500/min
   - **Action if high:** Check for brute force attack

4. **Certificate Pinning Failures**
   - ✅ Normal: 0
   - ⚠️ Warning: 1-10/min
   - 🔴 Critical: > 10/min
   - **Action if > 0:** Possible MITM attack

#### **Engineering Dashboard Review**

**Access:** https://monitoring.remittance-platform.com/d/engineering-dashboard

**Key Metrics to Watch:**

1. **API Response Time (p95)**
   - ✅ Normal: < 200ms
   - ⚠️ Warning: 200-500ms
   - 🔴 Critical: > 500ms
   - **Action if high:** Scale services or optimize queries

2. **Error Rate**
   - ✅ Normal: < 0.1%
   - ⚠️ Warning: 0.1-1%
   - 🔴 Critical: > 1%
   - **Action if high:** Check error logs

3. **CPU Usage**
   - ✅ Normal: < 70%
   - ⚠️ Warning: 70-85%
   - 🔴 Critical: > 85%
   - **Action if high:** Scale horizontally

4. **Memory Usage**
   - ✅ Normal: < 75%
   - ⚠️ Warning: 75-90%
   - 🔴 Critical: > 90%
   - **Action if high:** Investigate memory leaks

---

## 📆 Weekly Tasks

### **Monday: Backup Verification (30 minutes)**

#### **Step 1: Verify Automated Backups**

```bash
# Check backup files exist
ansible monitoring -i inventories/production -m shell \
  -a "ls -lh /var/backups/grafana/ | tail -10" -b
```

**Expected:** Daily backups for last 7 days

#### **Step 2: Test Backup Restore**

```bash
# Restore to test environment
ansible-playbook -i inventories/staging playbooks/restore-backup.yml \
  -e "backup_date=2025-10-29"
```

**Expected:** Successful restore with all dashboards

#### **Step 3: Verify S3 Backups**

```bash
# List S3 backups
aws s3 ls s3://remittance-monitoring-backups/ --recursive | tail -10
```

**Expected:** Backups uploaded to S3

**Weekly Backup Checklist:**
- [ ] Local backups exist (7 days)
- [ ] S3 backups uploaded
- [ ] Test restore successful
- [ ] Backup size reasonable (< 500MB)

---

### **Wednesday: Performance Review (45 minutes)**

#### **Step 1: Review Dashboard Performance**

```bash
# Check dashboard load times
curl -w "@curl-format.txt" -o /dev/null -s \
  -u admin:$GRAFANA_ADMIN_PASSWORD \
  https://monitoring.remittance-platform.com/api/dashboards/uid/executive-dashboard
```

**Expected:** Response time < 500ms

#### **Step 2: Analyze Prometheus Query Performance**

```bash
# Check slow queries
curl -s https://prometheus.remittance-platform.com/api/v1/status/tsdb | jq '.data'
```

**Look for:**
- High cardinality metrics
- Large number of series
- Slow queries

#### **Step 3: Review Resource Usage Trends**

Access Engineering Dashboard and review:
- CPU usage trends (last 7 days)
- Memory usage trends
- Disk I/O patterns
- Network bandwidth

**Action Items:**
- Document any concerning trends
- Plan capacity upgrades if needed
- Optimize queries if performance degrading

---

### **Friday: Security Audit (1 hour)**

#### **Step 1: Review Security Logs**

```bash
# Check authentication logs
ansible monitoring -i inventories/production -m shell \
  -a "grep 'authentication' /var/log/grafana/grafana.log | tail -50" -b
```

**Look for:**
- Failed login attempts
- Unusual access patterns
- New user creations

#### **Step 2: Verify SSL Certificates**

```bash
# Check certificate expiry
echo | openssl s_client -servername monitoring.remittance-platform.com \
  -connect monitoring.remittance-platform.com:443 2>/dev/null | \
  openssl x509 -noout -dates
```

**Expected:** Valid for > 30 days

#### **Step 3: Review Access Logs**

```bash
# Check for suspicious activity
ansible monitoring -i inventories/production -m shell \
  -a "tail -100 /var/log/nginx/access.log | grep -v '200 OK'" -b
```

**Look for:**
- Unusual IP addresses
- Failed requests
- Scanning attempts

#### **Step 4: Update Security Documentation**

- Document any security incidents
- Update access control lists
- Review and rotate credentials if needed

---

## 🚀 Deployment Procedures

### **Standard Deployment (Staging → Production)**

**Duration:** 45-60 minutes  
**Downtime:** None (zero-downtime deployment)  
**Team Required:** 1 DevOps engineer  
**Best Time:** Tuesday/Wednesday, 10 AM - 2 PM

#### **Pre-Deployment Checklist**

- [ ] Changes tested locally
- [ ] Code reviewed and approved
- [ ] Staging deployment successful
- [ ] Backup completed
- [ ] Team notified (#devops channel)
- [ ] Change ticket created (JIRA)
- [ ] Rollback plan ready

#### **Step 1: Pre-Deployment Validation (10 min)**

```bash
cd ~/ansible-grafana-deployment

# 1. Verify inventory
cat inventories/production/hosts.yml

# 2. Check connectivity
ansible monitoring -i inventories/production -m ping

# 3. Validate playbook syntax
ansible-playbook playbooks/deploy-monitoring.yml --syntax-check

# 4. Run lint
ansible-lint playbooks/deploy-monitoring.yml

# 5. Verify secrets are set
echo "Grafana password: ${GRAFANA_ADMIN_PASSWORD:0:3}***"
echo "Slack webhook: ${SLACK_WEBHOOK_URL:0:20}***"
```

**All checks must pass before proceeding.**

#### **Step 2: Deploy to Staging (15 min)**

```bash
# 1. Announce deployment
# Post in #devops: "Starting staging deployment - monitoring stack"

# 2. Run deployment
ansible-playbook -i inventories/staging playbooks/deploy-monitoring.yml \
  -e "environment=staging" \
  -v | tee deployment-staging-$(date +%Y%m%d-%H%M%S).log

# 3. Wait for completion
# Expected time: 10-15 minutes

# 4. Verify deployment
ansible-playbook -i inventories/staging playbooks/ci-cd-deploy.yml \
  --tags healthcheck,smoketest
```

**Expected Result:** All tasks successful, all tests passed

**If deployment fails:**
→ See [Troubleshooting: Deployment Failures](#deployment-failures)

#### **Step 3: Staging Validation (10 min)**

```bash
# 1. Access Grafana
open https://staging-monitoring.remittance-platform.com

# 2. Verify dashboards load
curl -s -u admin:$GRAFANA_ADMIN_PASSWORD \
  https://staging-monitoring.remittance-platform.com/api/search?type=dash-db | \
  jq '.[].title'

# 3. Check Prometheus
curl -s http://staging-prometheus:9090/api/v1/targets | \
  jq '.data.activeTargets[] | {job: .labels.job, health: .health}'

# 4. Test a query
curl -s 'http://staging-prometheus:9090/api/v1/query?query=up' | \
  jq '.data.result[] | {instance: .metric.instance, value: .value[1]}'
```

**Validation Checklist:**
- [ ] Grafana accessible
- [ ] All 3 dashboards present
- [ ] Dashboards render correctly
- [ ] Prometheus targets up
- [ ] Queries return data
- [ ] No errors in logs

**If validation fails:**
→ Fix issues before proceeding to production

#### **Step 4: Production Backup (5 min)**

```bash
# 1. Trigger backup
ansible-playbook -i inventories/production playbooks/ci-cd-deploy.yml \
  --tags backup \
  -e "environment=production"

# 2. Verify backup created
ansible monitoring -i inventories/production -m shell \
  -a "ls -lh /var/backups/grafana/$(date +%Y-%m-%d)/" -b

# 3. Verify S3 backup
aws s3 ls s3://remittance-monitoring-backups/$(date +%Y-%m-%d)/
```

**Expected:** Backup files created with today's date

#### **Step 5: Production Deployment (15 min)**

```bash
# 1. Announce deployment
# Post in #devops: "🚀 Starting PRODUCTION deployment - monitoring stack"
# Post in #general: "Monitoring stack update in progress - no impact expected"

# 2. Run deployment
ansible-playbook -i inventories/production playbooks/deploy-monitoring.yml \
  -e "environment=production" \
  -v | tee deployment-production-$(date +%Y%m%d-%H%M%S).log

# 3. Monitor progress
# Watch for any errors or warnings
# Expected time: 10-15 minutes
```

**During Deployment:**
- Watch Slack for alerts
- Monitor #devops channel
- Keep PagerDuty open
- Have rollback command ready

#### **Step 6: Production Validation (10 min)**

```bash
# 1. Run health checks
ansible-playbook -i inventories/production playbooks/ci-cd-deploy.yml \
  --tags healthcheck,smoketest \
  -e "environment=production"

# 2. Verify dashboards
curl -s -u admin:$GRAFANA_ADMIN_PASSWORD \
  https://monitoring.remittance-platform.com/api/search?type=dash-db | \
  jq '.[].title'

# 3. Check all services
ansible monitoring -i inventories/production -m systemd \
  -a "name=grafana-server" -b

ansible monitoring -i inventories/production -m systemd \
  -a "name=prometheus" -b

ansible monitoring -i inventories/production -m systemd \
  -a "name=alertmanager" -b

# 4. Verify Prometheus targets
curl -s https://prometheus.remittance-platform.com/api/v1/targets | \
  jq '.data.activeTargets[] | select(.health != "up")'

# Expected: Empty (all targets healthy)

# 5. Check for alerts
curl -s https://alerts.remittance-platform.com/api/v2/alerts | \
  jq '[.[] | select(.status.state == "active")]'

# Expected: Empty or known alerts only
```

**Production Validation Checklist:**
- [ ] All services running
- [ ] Grafana accessible
- [ ] All dashboards present and rendering
- [ ] Prometheus targets healthy
- [ ] No unexpected alerts
- [ ] No errors in logs
- [ ] Response times normal

#### **Step 7: Post-Deployment (5 min)**

```bash
# 1. Create deployment tag
git tag -a "deploy-prod-$(date +%Y%m%d-%H%M%S)" \
  -m "Production deployment - monitoring stack"
git push origin --tags

# 2. Update change ticket
# Mark JIRA ticket as "Deployed to Production"

# 3. Announce completion
# Post in #devops: "✅ Production deployment complete - all systems healthy"
# Post in #general: "Monitoring stack update complete - thank you!"

# 4. Document deployment
cat > deployment-notes-$(date +%Y%m%d).md <<EOF
# Deployment Notes - $(date +%Y-%m-%d)

## Changes Deployed
- [List changes]

## Deployment Time
- Start: $(date)
- Duration: [X minutes]

## Issues Encountered
- [None or list issues]

## Validation Results
- Services: ✅ All running
- Dashboards: ✅ All loaded
- Targets: ✅ All healthy
- Alerts: ✅ None firing

## Team Members
- Deployed by: [Your name]
- Reviewed by: [Reviewer name]
EOF

# 5. Archive logs
mv deployment-*.log ~/deployment-logs/
```

#### **Post-Deployment Monitoring (30 min)**

**Watch for 30 minutes after deployment:**

1. **Monitor dashboards**
   - Check all 3 dashboards every 5 minutes
   - Look for anomalies in metrics

2. **Watch Slack**
   - Monitor #alerts channel
   - Watch for user reports

3. **Check logs**
   ```bash
   # Tail logs in real-time
   ansible monitoring -i inventories/production -m shell \
     -a "journalctl -u grafana-server -f" -b
   ```

4. **Verify metrics**
   - API response times normal
   - Error rates stable
   - Resource usage stable

**If any issues arise:**
→ See [Rollback Procedures](#rollback-procedures)

---

## 🔧 Troubleshooting Guide

### **Service Not Running**

**Symptom:** `systemctl status` shows service as "inactive" or "failed"

#### **Grafana Not Running**

```bash
# 1. Check status
ansible monitoring -i inventories/production -m shell \
  -a "systemctl status grafana-server" -b

# 2. Check logs
ansible monitoring -i inventories/production -m shell \
  -a "journalctl -u grafana-server -n 100 --no-pager" -b

# 3. Common issues and fixes:

# Issue: Port 3000 already in use
ansible monitoring -i inventories/production -m shell \
  -a "lsof -i :3000" -b
# Fix: Kill conflicting process or change port

# Issue: Database connection failed
ansible monitoring -i inventories/production -m shell \
  -a "cat /etc/grafana/grafana.ini | grep database" -b
# Fix: Verify database credentials and connectivity

# Issue: Permission denied
ansible monitoring -i inventories/production -m shell \
  -a "ls -la /var/lib/grafana/" -b
# Fix: Correct ownership
ansible monitoring -i inventories/production -m shell \
  -a "chown -R grafana:grafana /var/lib/grafana" -b

# 4. Restart service
ansible monitoring -i inventories/production -m systemd \
  -a "name=grafana-server state=restarted daemon_reload=yes" -b

# 5. Verify it started
ansible monitoring -i inventories/production -m shell \
  -a "systemctl is-active grafana-server" -b
```

#### **Prometheus Not Running**

```bash
# 1. Check configuration
ansible monitoring -i inventories/production -m shell \
  -a "promtool check config /etc/prometheus/prometheus.yml" -b

# 2. Check logs
ansible monitoring -i inventories/production -m shell \
  -a "journalctl -u prometheus -n 100 --no-pager" -b

# 3. Common issues:

# Issue: Invalid configuration
# Fix: Validate and fix config
ansible monitoring -i inventories/production -m shell \
  -a "promtool check config /etc/prometheus/prometheus.yml" -b

# Issue: Storage full
ansible monitoring -i inventories/production -m shell \
  -a "df -h /var/lib/prometheus" -b
# Fix: Clean old data or increase storage

# Issue: Port 9090 in use
ansible monitoring -i inventories/production -m shell \
  -a "lsof -i :9090" -b

# 4. Restart
ansible monitoring -i inventories/production -m systemd \
  -a "name=prometheus state=restarted" -b
```

#### **AlertManager Not Running**

```bash
# 1. Check configuration
ansible monitoring -i inventories/production -m shell \
  -a "amtool check-config /etc/alertmanager/alertmanager.yml" -b

# 2. Check logs
ansible monitoring -i inventories/production -m shell \
  -a "journalctl -u alertmanager -n 100 --no-pager" -b

# 3. Restart
ansible monitoring -i inventories/production -m systemd \
  -a "name=alertmanager state=restarted" -b
```

---

### **Missing Dashboards**

**Symptom:** Dashboard count < 3 or specific dashboard not found

```bash
# 1. Check dashboard files exist
ansible monitoring -i inventories/production -m shell \
  -a "ls -la /var/lib/grafana/dashboards/" -b

# Expected: executive-dashboard.json, security-dashboard.json, engineering-dashboard.json

# 2. Check provisioning configuration
ansible monitoring -i inventories/production -m shell \
  -a "cat /etc/grafana/provisioning/dashboards/dashboards.yml" -b

# 3. Check Grafana logs for provisioning errors
ansible monitoring -i inventories/production -m shell \
  -a "grep 'provisioning' /var/log/grafana/grafana.log | tail -20" -b

# 4. Re-deploy dashboards
ansible-playbook -i inventories/production playbooks/deploy-monitoring.yml \
  --tags grafana \
  -e "environment=production"

# 5. Restart Grafana to reload
ansible monitoring -i inventories/production -m systemd \
  -a "name=grafana-server state=restarted" -b

# 6. Wait 30 seconds and verify
sleep 30
curl -s -u admin:$GRAFANA_ADMIN_PASSWORD \
  https://monitoring.remittance-platform.com/api/search?type=dash-db | \
  jq '.[].title'
```

---

### **Prometheus Targets Down**

**Symptom:** Prometheus shows targets as "down" or unhealthy

```bash
# 1. Identify down targets
curl -s https://prometheus.remittance-platform.com/api/v1/targets | \
  jq '.data.activeTargets[] | select(.health != "up") | {job: .labels.job, instance: .labels.instance, error: .lastError}'

# 2. Check target connectivity
# Replace with actual target host
ansible all -i "target-host," -m ping

# 3. Verify target is running
ansible all -i "target-host," -m shell -a "systemctl status node_exporter" -b

# 4. Check firewall
ansible all -i "target-host," -m shell -a "iptables -L -n | grep 9100" -b

# 5. Test scrape endpoint
curl -s http://target-host:9100/metrics | head -20

# 6. Common fixes:

# Fix 1: Restart exporter
ansible all -i "target-host," -m systemd -a "name=node_exporter state=restarted" -b

# Fix 2: Update Prometheus config
vi /etc/prometheus/prometheus.yml
# Add or fix target configuration

# Fix 3: Reload Prometheus
ansible monitoring -i inventories/production -m shell \
  -a "killall -HUP prometheus" -b

# 7. Verify target is now up
curl -s https://prometheus.remittance-platform.com/api/v1/targets | \
  jq '.data.activeTargets[] | select(.labels.instance == "target-host:9100") | .health'
```

---

### **Deployment Failures**

**Symptom:** Ansible playbook fails during execution

#### **Common Deployment Errors**

**Error 1: SSH Connection Failed**

```
UNREACHABLE! => {"changed": false, "msg": "Failed to connect to the host via ssh"}
```

**Fix:**
```bash
# 1. Test SSH manually
ssh ubuntu@monitoring-host

# 2. Check SSH key
ls -la ~/.ssh/id_rsa
chmod 600 ~/.ssh/id_rsa

# 3. Add host key
ssh-keyscan -H monitoring-host >> ~/.ssh/known_hosts

# 4. Verify inventory
cat inventories/production/hosts.yml

# 5. Test with Ansible
ansible monitoring -i inventories/production -m ping
```

**Error 2: Permission Denied (sudo)**

```
FAILED! => {"changed": false, "msg": "Missing sudo password"}
```

**Fix:**
```bash
# 1. Verify sudo access
ssh ubuntu@monitoring-host sudo whoami

# 2. Add to sudoers (on target)
echo "ubuntu ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/ubuntu

# 3. Or provide sudo password
ansible-playbook ... --ask-become-pass
```

**Error 3: Package Installation Failed**

```
FAILED! => {"changed": false, "msg": "Failed to update apt cache"}
```

**Fix:**
```bash
# 1. Update apt cache manually
ansible monitoring -i inventories/production -m apt \
  -a "update_cache=yes" -b

# 2. Check apt sources
ansible monitoring -i inventories/production -m shell \
  -a "apt-get update" -b

# 3. Re-run deployment
ansible-playbook -i inventories/production playbooks/deploy-monitoring.yml
```

**Error 4: Service Failed to Start**

```
FAILED! => {"changed": false, "msg": "Unable to start service grafana-server"}
```

**Fix:**
```bash
# 1. Check service status
ansible monitoring -i inventories/production -m shell \
  -a "systemctl status grafana-server" -b

# 2. Check logs
ansible monitoring -i inventories/production -m shell \
  -a "journalctl -u grafana-server -n 50" -b

# 3. Fix configuration error
# (See specific service troubleshooting above)

# 4. Re-run deployment
ansible-playbook -i inventories/production playbooks/deploy-monitoring.yml \
  --start-at-task="Start and enable Grafana service"
```

**Error 5: Timeout Waiting for Service**

```
FAILED! => {"changed": false, "msg": "Timeout when waiting for grafana:3000"}
```

**Fix:**
```bash
# 1. Check if service is actually running
ansible monitoring -i inventories/production -m shell \
  -a "systemctl is-active grafana-server" -b

# 2. Check if port is listening
ansible monitoring -i inventories/production -m shell \
  -a "netstat -tlnp | grep 3000" -b

# 3. Check firewall
ansible monitoring -i inventories/production -m shell \
  -a "iptables -L -n | grep 3000" -b

# 4. Increase timeout in playbook
# Edit playbook and change timeout value

# 5. Re-run
ansible-playbook -i inventories/production playbooks/deploy-monitoring.yml
```

---

### **Dashboard Not Loading**

**Symptom:** Dashboard shows "Dashboard not found" or fails to render

```bash
# 1. Check if dashboard exists in API
curl -s -u admin:$GRAFANA_ADMIN_PASSWORD \
  https://monitoring.remittance-platform.com/api/search?query=executive | jq '.'

# 2. Check dashboard JSON is valid
ansible monitoring -i inventories/production -m shell \
  -a "jq empty /var/lib/grafana/dashboards/executive-dashboard.json" -b

# 3. Check Grafana logs for errors
ansible monitoring -i inventories/production -m shell \
  -a "grep -i 'dashboard' /var/log/grafana/grafana.log | tail -20" -b

# 4. Re-provision dashboards
ansible monitoring -i inventories/production -m shell \
  -a "rm -f /var/lib/grafana/dashboards/*.json" -b

ansible-playbook -i inventories/production playbooks/deploy-monitoring.yml \
  --tags grafana

# 5. Restart Grafana
ansible monitoring -i inventories/production -m systemd \
  -a "name=grafana-server state=restarted" -b
```

---

### **Slow Dashboard Performance**

**Symptom:** Dashboards take > 5 seconds to load

```bash
# 1. Check Prometheus query performance
curl -s 'https://prometheus.remittance-platform.com/api/v1/query?query=up' \
  -w "\nTime: %{time_total}s\n"

# 2. Check for high cardinality
curl -s https://prometheus.remittance-platform.com/api/v1/status/tsdb | \
  jq '.data.seriesCountByMetricName | to_entries | sort_by(.value) | reverse | .[0:10]'

# 3. Check Grafana resource usage
ansible monitoring -i inventories/production -m shell \
  -a "ps aux | grep grafana" -b

# 4. Optimize queries in dashboard
# - Reduce time range
# - Use recording rules
# - Increase scrape interval

# 5. Increase Grafana resources
# Edit inventory and increase memory/CPU allocation

# 6. Enable query caching
ansible monitoring -i inventories/production -m shell \
  -a "grep 'dataproxy' /etc/grafana/grafana.ini" -b
```

---

## 🚨 Incident Response

### **Severity Levels**

| Level | Description | Response Time | Escalation |
|-------|-------------|---------------|------------|
| **P1 - Critical** | Complete outage, data loss | 15 minutes | Immediate |
| **P2 - High** | Major feature broken, degraded performance | 1 hour | If not resolved in 2 hours |
| **P3 - Medium** | Minor feature broken, workaround available | 4 hours | If not resolved in 8 hours |
| **P4 - Low** | Cosmetic issue, no impact | Next business day | None |

### **P1 - Critical Incident**

**Examples:**
- All monitoring services down
- Complete data loss
- Security breach detected
- Cannot access any dashboards

#### **Immediate Actions (First 5 minutes)**

```bash
# 1. Acknowledge incident
# Post in #incidents: "P1 INCIDENT - Monitoring stack down - investigating"

# 2. Page on-call team
# PagerDuty will auto-page based on alerts

# 3. Quick health check
ansible monitoring -i inventories/production -m ping

# 4. Check all services
ansible monitoring -i inventories/production -m shell \
  -a "systemctl status grafana-server prometheus alertmanager" -b

# 5. Check for recent changes
git log --oneline -10
# Check recent deployments in #devops
```

#### **Investigation (5-15 minutes)**

```bash
# 1. Check system resources
ansible monitoring -i inventories/production -m shell \
  -a "top -bn1 | head -20" -b

ansible monitoring -i inventories/production -m shell \
  -a "df -h" -b

ansible monitoring -i inventories/production -m shell \
  -a "free -h" -b

# 2. Check logs
ansible monitoring -i inventories/production -m shell \
  -a "journalctl --since '30 minutes ago' | grep -i error | tail -50" -b

# 3. Check network
ansible monitoring -i inventories/production -m shell \
  -a "netstat -tlnp" -b

# 4. Document findings
# Update #incidents thread with findings
```

#### **Resolution (15-30 minutes)**

**Option 1: Service Restart**
```bash
# If services crashed
ansible monitoring -i inventories/production -m systemd \
  -a "name=grafana-server state=restarted" -b

ansible monitoring -i inventories/production -m systemd \
  -a "name=prometheus state=restarted" -b

ansible monitoring -i inventories/production -m systemd \
  -a "name=alertmanager state=restarted" -b
```

**Option 2: Rollback**
```bash
# If caused by recent deployment
ansible-playbook -i inventories/production playbooks/ci-cd-deploy.yml \
  --tags rollback \
  -e "environment=production"
```

**Option 3: Restore from Backup**
```bash
# If data corruption
ansible-playbook -i inventories/production playbooks/restore-backup.yml \
  -e "backup_date=$(date -d yesterday +%Y-%m-%d)"
```

#### **Post-Incident (After resolution)**

```bash
# 1. Verify resolution
ansible-playbook -i inventories/production playbooks/ci-cd-deploy.yml \
  --tags healthcheck,smoketest

# 2. Announce resolution
# Post in #incidents: "✅ RESOLVED - Monitoring stack restored - RCA to follow"

# 3. Create incident report
cat > incident-report-$(date +%Y%m%d).md <<EOF
# Incident Report - $(date +%Y-%m-%d)

## Summary
[Brief description]

## Timeline
- [HH:MM] Incident detected
- [HH:MM] Team paged
- [HH:MM] Root cause identified
- [HH:MM] Fix applied
- [HH:MM] Incident resolved

## Root Cause
[Detailed explanation]

## Impact
- Duration: [X minutes]
- Affected users: [Number or %]
- Data loss: [Yes/No]

## Resolution
[What was done to fix]

## Prevention
[What will be done to prevent recurrence]

## Action Items
- [ ] [Action 1]
- [ ] [Action 2]
EOF

# 4. Schedule post-mortem meeting
# Within 24 hours of incident
```

---

### **P2 - High Severity Incident**

**Examples:**
- Single dashboard not working
- Prometheus targets down
- High error rate
- Alerts not firing

**Follow similar process as P1 but with:**
- 1 hour response time
- Less urgency
- Can be handled by single engineer
- Escalate if not resolved in 2 hours

---

## 🔄 Rollback Procedures

### **Automated Rollback**

**When to use:**
- Recent deployment caused issues
- Services not starting after update
- Dashboards broken after change

```bash
# 1. Announce rollback
# Post in #devops: "🔄 Initiating rollback - monitoring stack"

# 2. Run rollback playbook
ansible-playbook -i inventories/production playbooks/ci-cd-deploy.yml \
  --tags rollback \
  -e "environment=production" \
  -v | tee rollback-$(date +%Y%m%d-%H%M%S).log

# 3. Verify services
ansible monitoring -i inventories/production -m systemd \
  -a "name=grafana-server" -b

ansible monitoring -i inventories/production -m systemd \
  -a "name=prometheus" -b

# 4. Run health checks
ansible-playbook -i inventories/production playbooks/ci-cd-deploy.yml \
  --tags healthcheck

# 5. Verify dashboards
curl -s -u admin:$GRAFANA_ADMIN_PASSWORD \
  https://monitoring.remittance-platform.com/api/search?type=dash-db | \
  jq '.[].title'

# 6. Announce completion
# Post in #devops: "✅ Rollback complete - services restored"
```

---

### **Manual Rollback**

**When to use:**
- Automated rollback failed
- Need to restore specific component
- Complex configuration change

```bash
# 1. Stop services
ansible monitoring -i inventories/production -m systemd \
  -a "name=grafana-server state=stopped" -b

ansible monitoring -i inventories/production -m systemd \
  -a "name=prometheus state=stopped" -b

# 2. Restore configuration files
ansible monitoring -i inventories/production -m copy \
  -a "src=/var/backups/grafana/$(date -d yesterday +%Y-%m-%d)/grafana.ini dest=/etc/grafana/grafana.ini remote_src=yes" -b

# 3. Restore database (if needed)
ansible monitoring -i inventories/production -m shell \
  -a "sqlite3 /var/lib/grafana/grafana.db '.restore /var/backups/grafana/$(date -d yesterday +%Y-%m-%d)/grafana.db'" -b

# 4. Restore dashboards
ansible monitoring -i inventories/production -m shell \
  -a "tar -xzf /var/backups/grafana/$(date -d yesterday +%Y-%m-%d)/dashboards.tar.gz -C /var/lib/grafana/" -b

# 5. Start services
ansible monitoring -i inventories/production -m systemd \
  -a "name=grafana-server state=started" -b

ansible monitoring -i inventories/production -m systemd \
  -a "name=prometheus state=started" -b

# 6. Verify
ansible-playbook -i inventories/production playbooks/ci-cd-deploy.yml \
  --tags healthcheck
```

---

## 🛠️ Maintenance Tasks

### **Disk Cleanup**

**When:** Disk usage > 80%

```bash
# 1. Check disk usage
ansible monitoring -i inventories/production -m shell \
  -a "df -h" -b

# 2. Find large files
ansible monitoring -i inventories/production -m shell \
  -a "du -sh /var/lib/prometheus/* | sort -h | tail -10" -b

# 3. Clean Prometheus old data
ansible monitoring -i inventories/production -m shell \
  -a "find /var/lib/prometheus -type f -mtime +30 -delete" -b

# 4. Clean Grafana logs
ansible monitoring -i inventories/production -m shell \
  -a "find /var/log/grafana -name '*.log.*' -mtime +7 -delete" -b

# 5. Clean old backups
ansible monitoring -i inventories/production -m shell \
  -a "find /var/backups/grafana -type d -mtime +30 -exec rm -rf {} +" -b

# 6. Verify space freed
ansible monitoring -i inventories/production -m shell \
  -a "df -h" -b
```

---

### **Certificate Renewal**

**When:** Certificate expires in < 30 days

```bash
# 1. Check certificate expiry
echo | openssl s_client -servername monitoring.remittance-platform.com \
  -connect monitoring.remittance-platform.com:443 2>/dev/null | \
  openssl x509 -noout -dates

# 2. Obtain new certificate
# (Use Let's Encrypt, internal CA, or commercial CA)

# 3. Copy certificate to servers
ansible monitoring -i inventories/production -m copy \
  -a "src=./new-cert.pem dest=/etc/ssl/certs/monitoring.pem" -b

ansible monitoring -i inventories/production -m copy \
  -a "src=./new-key.pem dest=/etc/ssl/private/monitoring-key.pem mode=0600" -b

# 4. Reload web server
ansible monitoring -i inventories/production -m systemd \
  -a "name=nginx state=reloaded" -b

# 5. Verify new certificate
echo | openssl s_client -servername monitoring.remittance-platform.com \
  -connect monitoring.remittance-platform.com:443 2>/dev/null | \
  openssl x509 -noout -dates
```

---

### **Password Rotation**

**When:** Every 90 days or after team member departure

```bash
# 1. Generate new password
NEW_PASSWORD=$(openssl rand -base64 32)

# 2. Update Grafana admin password
curl -X PUT \
  -H "Content-Type: application/json" \
  -u admin:$GRAFANA_ADMIN_PASSWORD \
  https://monitoring.remittance-platform.com/api/user/password \
  -d "{\"oldPassword\":\"$GRAFANA_ADMIN_PASSWORD\",\"newPassword\":\"$NEW_PASSWORD\",\"confirmNew\":\"$NEW_PASSWORD\"}"

# 3. Update in secrets management
# 1Password / Vault / etc.

# 4. Update environment variable
export GRAFANA_ADMIN_PASSWORD="$NEW_PASSWORD"

# 5. Update in CI/CD
# Update Jenkins credentials
# Update GitHub secrets

# 6. Test new password
curl -s -u admin:$NEW_PASSWORD \
  https://monitoring.remittance-platform.com/api/org

# 7. Notify team
# Post in #devops: "Grafana admin password rotated - check 1Password"
```

---

## 📞 Emergency Contacts

### **On-Call Rotation**

| Week | Primary | Secondary | Manager |
|------|---------|-----------|---------|
| Current | See PagerDuty | See PagerDuty | See PagerDuty |

**PagerDuty:** https://remittance.pagerduty.com

### **Escalation Path**

1. **Level 1:** On-call DevOps Engineer
2. **Level 2:** DevOps Team Lead
3. **Level 3:** Engineering Manager
4. **Level 4:** CTO

### **Team Contacts**

| Role | Name | Slack | Phone | Email |
|------|------|-------|-------|-------|
| DevOps Lead | [Name] | @devops-lead | +1-XXX-XXX-XXXX | devops-lead@company.com |
| SRE Lead | [Name] | @sre-lead | +1-XXX-XXX-XXXX | sre-lead@company.com |
| Security Lead | [Name] | @security-lead | +1-XXX-XXX-XXXX | security-lead@company.com |
| Engineering Manager | [Name] | @eng-manager | +1-XXX-XXX-XXXX | eng-manager@company.com |

### **Vendor Support**

| Vendor | Support URL | SLA | Contact |
|--------|-------------|-----|---------|
| Grafana Labs | https://grafana.com/support | 24/7 | support@grafana.com |
| AWS | https://console.aws.amazon.com/support | 24/7 | Via console |
| Slack | https://slack.com/help | Business hours | Via app |

### **Slack Channels**

- **#devops** - General DevOps discussion
- **#incidents** - Active incident coordination
- **#alerts** - Automated alerts from monitoring
- **#deployments** - Deployment announcements
- **#devops-oncall** - On-call coordination

---

## 📚 Additional Resources

### **Documentation**

- [Ansible Automation README](./README.md)
- [Dashboard Installation Guide](./grafana-dashboards/DASHBOARD_INSTALLATION_GUIDE.md)
- [Grafana Official Docs](https://grafana.com/docs/)
- [Prometheus Official Docs](https://prometheus.io/docs/)

### **Playbooks**

- `playbooks/deploy-monitoring.yml` - Main deployment
- `playbooks/ci-cd-deploy.yml` - CI/CD integration
- `playbooks/restore-backup.yml` - Backup restore
- `playbooks/rotate-credentials.yml` - Password rotation

### **Training Materials**

- Ansible Basics: [Internal Wiki](https://wiki.company.com/ansible)
- Grafana Training: [Grafana University](https://grafana.com/training/)
- Incident Response: [Internal Wiki](https://wiki.company.com/incident-response)

---

## ✅ Runbook Checklist

Print this checklist and keep it handy:

### **Daily**
- [ ] Morning health check (9 AM)
- [ ] Dashboard monitoring (continuous)
- [ ] Review alerts (as they come)
- [ ] Check disk space
- [ ] Review logs for errors

### **Weekly**
- [ ] Monday: Backup verification
- [ ] Wednesday: Performance review
- [ ] Friday: Security audit
- [ ] Update documentation

### **Monthly**
- [ ] Review and update runbook
- [ ] Test rollback procedures
- [ ] Rotate credentials
- [ ] Capacity planning review
- [ ] Team training session

### **Quarterly**
- [ ] Disaster recovery drill
- [ ] Update emergency contacts
- [ ] Review SLAs and metrics
- [ ] Vendor support review

---

**End of Runbook**

**Version:** 1.0  
**Last Updated:** October 29, 2025  
**Next Review:** November 29, 2025  

**Questions or Issues?**  
Contact: devops@remittance-platform.com  
Slack: #devops

