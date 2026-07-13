###############################################################################
# RemitFlow — Route53 Module
# Implements latency-based routing with health checks for active-active
# multi-region failover across us-east-1, eu-west-1, ap-southeast-1.
###############################################################################

# ── Hosted Zone (created once, referenced everywhere) ─────────────────────────
data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# ── Health Checks for each region's ALB ───────────────────────────────────────
resource "aws_route53_health_check" "api" {
  for_each = var.regional_endpoints

  fqdn              = each.value.alb_dns_name
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/health"
  failure_threshold = 3
  request_interval  = 10

  regions = ["us-east-1", "eu-west-1", "ap-southeast-1"]

  tags = merge(var.tags, {
    Name   = "remitflow-api-health-${each.key}"
    Region = each.key
  })
}

# ── Latency-Based Routing Records (active-active) ────────────────────────────
resource "aws_route53_record" "api" {
  for_each = var.regional_endpoints

  zone_id        = data.aws_route53_zone.main.zone_id
  name           = "api.${var.domain_name}"
  type           = "A"
  set_identifier = each.key

  latency_routing_policy {
    region = each.key
  }

  alias {
    name                   = each.value.alb_dns_name
    zone_id                = each.value.alb_zone_id
    evaluate_target_health = true
  }

  health_check_id = aws_route53_health_check.api[each.key].id
}

# ── Weighted Routing for Canary Deployments ───────────────────────────────────
resource "aws_route53_record" "api_canary" {
  count = var.canary_endpoint != null ? 1 : 0

  zone_id        = data.aws_route53_zone.main.zone_id
  name           = "api-canary.${var.domain_name}"
  type           = "A"
  set_identifier = "canary"

  weighted_routing_policy {
    weight = var.canary_weight
  }

  alias {
    name                   = var.canary_endpoint.alb_dns_name
    zone_id                = var.canary_endpoint.alb_zone_id
    evaluate_target_health = true
  }
}

# ── Internal DNS for service-to-service communication ─────────────────────────
resource "aws_route53_zone" "internal" {
  name = "internal.${var.domain_name}"

  vpc {
    vpc_id = var.primary_vpc_id
  }

  tags = merge(var.tags, { Name = "remitflow-internal-zone" })
}

resource "aws_route53_record" "internal_services" {
  for_each = var.internal_service_endpoints

  zone_id = aws_route53_zone.internal.zone_id
  name    = "${each.key}.internal.${var.domain_name}"
  type    = "CNAME"
  ttl     = 30
  records = [each.value]
}
