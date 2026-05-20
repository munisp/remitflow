# Mojaloop Hub PostgreSQL RDS Module
# Dedicated PostgreSQL instance for Mojaloop Hub with HA configuration
#
# This module creates a separate RDS PostgreSQL cluster for the Mojaloop Hub
# to maintain clear separation between platform data and Mojaloop scheme data.

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

# Random password for Mojaloop DB
resource "random_password" "mojaloop_db_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# DB Subnet Group
resource "aws_db_subnet_group" "mojaloop" {
  name        = "${var.identifier}-mojaloop-subnet-group"
  description = "Subnet group for Mojaloop Hub PostgreSQL"
  subnet_ids  = var.subnet_ids

  tags = merge(var.tags, {
    Name = "${var.identifier}-mojaloop-subnet-group"
  })
}

# Security Group for Mojaloop RDS
resource "aws_security_group" "mojaloop_rds" {
  name        = "${var.identifier}-mojaloop-rds-sg"
  description = "Security group for Mojaloop Hub PostgreSQL"
  vpc_id      = var.vpc_id

  ingress {
    description     = "PostgreSQL from EKS"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = var.eks_security_group_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${var.identifier}-mojaloop-rds-sg"
  })
}

# Parameter Group for PostgreSQL optimization
resource "aws_db_parameter_group" "mojaloop" {
  name        = "${var.identifier}-mojaloop-pg15"
  family      = "postgres15"
  description = "PostgreSQL 15 parameters optimized for Mojaloop Hub"

  # Connection settings
  parameter {
    name  = "max_connections"
    value = "500"
  }

  # Memory settings
  parameter {
    name  = "shared_buffers"
    value = "{DBInstanceClassMemory/4}"
  }

  parameter {
    name  = "effective_cache_size"
    value = "{DBInstanceClassMemory*3/4}"
  }

  parameter {
    name  = "work_mem"
    value = "65536"  # 64MB
  }

  parameter {
    name  = "maintenance_work_mem"
    value = "524288"  # 512MB
  }

  # WAL settings for durability
  parameter {
    name  = "wal_buffers"
    value = "65536"  # 64MB
  }

  parameter {
    name  = "checkpoint_completion_target"
    value = "0.9"
  }

  # Query optimization
  parameter {
    name  = "random_page_cost"
    value = "1.1"  # SSD-optimized
  }

  parameter {
    name  = "effective_io_concurrency"
    value = "200"  # SSD-optimized
  }

  # Logging
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"  # Log queries > 1 second
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  tags = var.tags
}

# RDS PostgreSQL Instance for Mojaloop Hub
resource "aws_db_instance" "mojaloop" {
  identifier = "${var.identifier}-mojaloop"

  # Engine configuration
  engine               = "postgres"
  engine_version       = var.engine_version
  instance_class       = var.instance_class
  parameter_group_name = aws_db_parameter_group.mojaloop.name

  # Storage configuration
  allocated_storage     = var.allocated_storage
  max_allocated_storage = var.max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id           = var.kms_key_id

  # Database configuration
  db_name  = "mojaloop_hub"
  username = "mojaloop_admin"
  password = random_password.mojaloop_db_password.result
  port     = 5432

  # Network configuration
  db_subnet_group_name   = aws_db_subnet_group.mojaloop.name
  vpc_security_group_ids = [aws_security_group.mojaloop_rds.id]
  publicly_accessible    = false

  # High Availability
  multi_az = var.multi_az

  # Backup configuration
  backup_retention_period   = var.backup_retention_period
  backup_window            = "03:00-04:00"
  maintenance_window       = "Mon:04:00-Mon:05:00"
  copy_tags_to_snapshot    = true
  delete_automated_backups = false
  skip_final_snapshot      = false
  final_snapshot_identifier = "${var.identifier}-mojaloop-final-snapshot"

  # Performance Insights
  performance_insights_enabled          = true
  performance_insights_retention_period = var.environment == "production" ? 731 : 7

  # Enhanced Monitoring
  monitoring_interval = 60
  monitoring_role_arn = var.monitoring_role_arn

  # Auto minor version upgrade
  auto_minor_version_upgrade = true

  # Deletion protection
  deletion_protection = var.environment == "production"

  tags = merge(var.tags, {
    Name        = "${var.identifier}-mojaloop"
    Component   = "mojaloop-hub"
    Database    = "postgresql"
  })

  lifecycle {
    prevent_destroy = false
  }
}

# Read Replica for production (optional)
resource "aws_db_instance" "mojaloop_replica" {
  count = var.create_read_replica ? 1 : 0

  identifier = "${var.identifier}-mojaloop-replica"

  # Replica configuration
  replicate_source_db = aws_db_instance.mojaloop.identifier
  instance_class      = var.replica_instance_class

  # Storage (inherited from primary)
  storage_encrypted = true
  kms_key_id       = var.kms_key_id

  # Network configuration
  vpc_security_group_ids = [aws_security_group.mojaloop_rds.id]
  publicly_accessible    = false

  # No Multi-AZ for replica (it's already in a different AZ)
  multi_az = false

  # Performance Insights
  performance_insights_enabled          = true
  performance_insights_retention_period = var.environment == "production" ? 731 : 7

  # Enhanced Monitoring
  monitoring_interval = 60
  monitoring_role_arn = var.monitoring_role_arn

  # Auto minor version upgrade
  auto_minor_version_upgrade = true

  tags = merge(var.tags, {
    Name        = "${var.identifier}-mojaloop-replica"
    Component   = "mojaloop-hub"
    Database    = "postgresql"
    Role        = "read-replica"
  })
}

# Store credentials in Secrets Manager
resource "aws_secretsmanager_secret" "mojaloop_db" {
  name        = "${var.identifier}/mojaloop/database"
  description = "Mojaloop Hub PostgreSQL credentials"

  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "mojaloop_db" {
  secret_id = aws_secretsmanager_secret.mojaloop_db.id
  secret_string = jsonencode({
    username = aws_db_instance.mojaloop.username
    password = random_password.mojaloop_db_password.result
    host     = aws_db_instance.mojaloop.address
    port     = aws_db_instance.mojaloop.port
    database = aws_db_instance.mojaloop.db_name
    engine   = "postgres"
    
    # Connection URL for Knex.js
    connection_url = "postgresql://${aws_db_instance.mojaloop.username}:${random_password.mojaloop_db_password.result}@${aws_db_instance.mojaloop.address}:${aws_db_instance.mojaloop.port}/${aws_db_instance.mojaloop.db_name}?ssl=true"
    
    # Read replica endpoint (if exists)
    read_replica_host = var.create_read_replica ? aws_db_instance.mojaloop_replica[0].address : null
  })
}

# Outputs
output "endpoint" {
  description = "Mojaloop RDS endpoint"
  value       = aws_db_instance.mojaloop.address
}

output "port" {
  description = "Mojaloop RDS port"
  value       = aws_db_instance.mojaloop.port
}

output "database_name" {
  description = "Mojaloop database name"
  value       = aws_db_instance.mojaloop.db_name
}

output "username" {
  description = "Mojaloop database username"
  value       = aws_db_instance.mojaloop.username
  sensitive   = true
}

output "secret_arn" {
  description = "ARN of the Secrets Manager secret containing credentials"
  value       = aws_secretsmanager_secret.mojaloop_db.arn
}

output "security_group_id" {
  description = "Security group ID for Mojaloop RDS"
  value       = aws_security_group.mojaloop_rds.id
}

output "read_replica_endpoint" {
  description = "Read replica endpoint (if created)"
  value       = var.create_read_replica ? aws_db_instance.mojaloop_replica[0].address : null
}
