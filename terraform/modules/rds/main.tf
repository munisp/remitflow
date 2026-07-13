###############################################################################
# RemitFlow — RDS Aurora PostgreSQL Module
# Creates an Aurora PostgreSQL Global Database for active-active multi-region.
# Primary cluster in us-east-1, secondary in eu-west-1 and ap-southeast-1.
###############################################################################

# ── KMS Key for RDS Encryption ────────────────────────────────────────────────
resource "aws_kms_key" "rds" {
  description             = "RemitFlow RDS encryption — ${var.cluster_identifier}"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = merge(var.tags, { Name = "${var.cluster_identifier}-rds-kms" })
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${var.cluster_identifier}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

# ── Aurora Global Cluster (primary region only) ───────────────────────────────
resource "aws_rds_global_cluster" "main" {
  count                     = var.is_primary ? 1 : 0
  global_cluster_identifier = "${var.cluster_identifier}-global"
  engine                    = "aurora-postgresql"
  engine_version            = var.engine_version
  database_name             = var.database_name
  storage_encrypted         = true
}

# ── Security Group ────────────────────────────────────────────────────────────
resource "aws_security_group" "rds" {
  name        = "${var.cluster_identifier}-rds-sg"
  description = "RemitFlow RDS Aurora security group"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "PostgreSQL from EKS nodes"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.cluster_identifier}-rds-sg" })
}

# ── Aurora Cluster ────────────────────────────────────────────────────────────
resource "aws_rds_cluster" "main" {
  cluster_identifier        = var.cluster_identifier
  engine                    = "aurora-postgresql"
  engine_version            = var.engine_version
  engine_mode               = "provisioned"
  global_cluster_identifier = var.is_primary ? aws_rds_global_cluster.main[0].id : var.global_cluster_identifier
  database_name             = var.is_primary ? var.database_name : null
  master_username           = var.is_primary ? var.master_username : null
  master_password           = var.is_primary ? var.master_password : null
  db_subnet_group_name      = var.db_subnet_group_name
  vpc_security_group_ids    = [aws_security_group.rds.id]
  kms_key_id                = aws_kms_key.rds.arn
  storage_encrypted         = true

  # Backup and maintenance
  backup_retention_period   = var.backup_retention_days
  preferred_backup_window   = "03:00-04:00"
  preferred_maintenance_window = "sun:04:00-sun:05:00"
  copy_tags_to_snapshot     = true
  deletion_protection       = var.deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.cluster_identifier}-final-snapshot"

  # Enhanced monitoring and logging
  enabled_cloudwatch_logs_exports = ["postgresql"]

  # Performance Insights
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.rds.arn
  performance_insights_retention_period = 7

  serverlessv2_scaling_configuration {
    min_capacity = var.serverless_min_acu
    max_capacity = var.serverless_max_acu
  }

  tags = var.tags

  lifecycle {
    ignore_changes = [master_password, global_cluster_identifier]
  }
}

# ── Aurora Instances (writer + reader) ───────────────────────────────────────
resource "aws_rds_cluster_instance" "writer" {
  identifier              = "${var.cluster_identifier}-writer"
  cluster_identifier      = aws_rds_cluster.main.id
  instance_class          = "db.serverless"
  engine                  = aws_rds_cluster.main.engine
  engine_version          = aws_rds_cluster.main.engine_version
  db_subnet_group_name    = var.db_subnet_group_name
  monitoring_interval     = 60
  monitoring_role_arn     = aws_iam_role.rds_monitoring.arn
  auto_minor_version_upgrade = true
  performance_insights_enabled = true
  tags                    = merge(var.tags, { Name = "${var.cluster_identifier}-writer" })
}

resource "aws_rds_cluster_instance" "reader" {
  count                   = var.reader_count
  identifier              = "${var.cluster_identifier}-reader-${count.index}"
  cluster_identifier      = aws_rds_cluster.main.id
  instance_class          = "db.serverless"
  engine                  = aws_rds_cluster.main.engine
  engine_version          = aws_rds_cluster.main.engine_version
  db_subnet_group_name    = var.db_subnet_group_name
  monitoring_interval     = 60
  monitoring_role_arn     = aws_iam_role.rds_monitoring.arn
  auto_minor_version_upgrade = true
  performance_insights_enabled = true
  tags                    = merge(var.tags, { Name = "${var.cluster_identifier}-reader-${count.index}" })
}

# ── Enhanced Monitoring IAM Role ──────────────────────────────────────────────
resource "aws_iam_role" "rds_monitoring" {
  name = "${var.cluster_identifier}-rds-monitoring-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "monitoring.rds.amazonaws.com" }
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
  role       = aws_iam_role.rds_monitoring.name
}

# ── Parameter Group ───────────────────────────────────────────────────────────
resource "aws_rds_cluster_parameter_group" "main" {
  family = "aurora-postgresql15"
  name   = "${var.cluster_identifier}-params"

  parameter {
    name  = "log_statement"
    value = "ddl"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"  # Log queries > 1 second
  }
  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements,auto_explain"
  }
  parameter {
    name  = "pg_stat_statements.track"
    value = "all"
  }

  tags = var.tags
}
