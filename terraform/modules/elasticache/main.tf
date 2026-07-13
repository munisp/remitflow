###############################################################################
# RemitFlow — ElastiCache Redis Module
# Provisions a Redis 7 Global Datastore for multi-region rate limiting,
# session caching, and real-time FX rate distribution.
###############################################################################

resource "aws_security_group" "redis" {
  name        = "${var.cluster_id}-redis-sg"
  description = "RemitFlow Redis security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.cluster_id}-redis-sg" })
}

resource "aws_kms_key" "redis" {
  description             = "RemitFlow Redis encryption — ${var.cluster_id}"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = merge(var.tags, { Name = "${var.cluster_id}-redis-kms" })
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = var.cluster_id
  description                = "RemitFlow Redis cluster — ${var.environment}"
  node_type                  = var.node_type
  num_cache_clusters         = var.num_cache_nodes
  parameter_group_name       = aws_elasticache_parameter_group.main.name
  subnet_group_name          = var.subnet_group_name
  security_group_ids         = [aws_security_group.redis.id]
  engine_version             = var.engine_version
  port                       = 6379
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  kms_key_id                 = aws_kms_key.redis.arn
  automatic_failover_enabled = var.num_cache_nodes > 1
  multi_az_enabled           = var.num_cache_nodes > 1
  auto_minor_version_upgrade = true
  maintenance_window         = "sun:05:00-sun:06:00"
  snapshot_retention_limit   = 7
  snapshot_window            = "04:00-05:00"

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_engine.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }

  tags = var.tags
}

resource "aws_elasticache_parameter_group" "main" {
  family = "redis7"
  name   = "${var.cluster_id}-params"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }
  parameter {
    name  = "notify-keyspace-events"
    value = "Ex"  # Expired key events for rate limit TTL
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "redis_slow" {
  name              = "/aws/elasticache/${var.cluster_id}/slow-log"
  retention_in_days = 14
  tags              = var.tags
}

resource "aws_cloudwatch_log_group" "redis_engine" {
  name              = "/aws/elasticache/${var.cluster_id}/engine-log"
  retention_in_days = 14
  tags              = var.tags
}
