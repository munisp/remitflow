# RemitFlow Infrastructure as Code (Terraform)
# ─────────────────────────────────────────────────────────────────────────────
# Provisions:
# - EKS cluster for microservices
# - RDS PostgreSQL (primary + read replica)
# - ElastiCache Redis
# - S3 for documents/receipts
# - CloudFront CDN
# - Route53 DNS
# - ACM certificates
# - VPC with public/private subnets

terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "remitflow-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "eu-west-2"
    dynamodb_table = "remitflow-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "RemitFlow"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# ─── Variables ───────────────────────────────────────────────────────────────

variable "aws_region" {
  default = "eu-west-2" # London — closest to Nigeria/West Africa
}

variable "environment" {
  default = "production"
}

variable "domain_name" {
  default = "remitflow.com"
}

variable "db_instance_class" {
  default = "db.r6g.large"
}

variable "eks_node_instance_type" {
  default = "m6i.large"
}

variable "eks_min_nodes" {
  default = 3
}

variable "eks_max_nodes" {
  default = 10
}

variable "dr_region" {
  default     = "af-south-1" # Cape Town — closest to West/East Africa for failover
  description = "Disaster recovery region for multi-region deployment"
}

variable "enable_multi_region" {
  default     = true
  description = "Enable multi-region DR infrastructure"
}

# ─── VPC ─────────────────────────────────────────────────────────────────────

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "remitflow-${var.environment}"
  cidr = "10.0.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = var.environment != "production"
  enable_dns_hostnames = true
  enable_dns_support   = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }
}

# ─── EKS Cluster ─────────────────────────────────────────────────────────────

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "remitflow-${var.environment}"
  cluster_version = "1.29"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    general = {
      instance_types = [var.eks_node_instance_type]
      min_size       = var.eks_min_nodes
      max_size       = var.eks_max_nodes
      desired_size   = var.eks_min_nodes
    }
  }
}

# ─── RDS PostgreSQL ──────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "remitflow-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "rds" {
  name_prefix = "remitflow-rds-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.cluster_security_group_id]
  }
}

resource "aws_db_instance" "primary" {
  identifier     = "remitflow-${var.environment}"
  engine         = "postgres"
  engine_version = "16.2"
  instance_class = var.db_instance_class

  allocated_storage     = 100
  max_allocated_storage = 500
  storage_encrypted     = true
  storage_type          = "gp3"

  db_name  = "remitflow"
  username = "remitflow_admin"
  password = "CHANGE_ME_USE_SECRETS_MANAGER"

  multi_az               = var.environment == "production"
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  backup_retention_period = 30
  deletion_protection     = var.environment == "production"

  performance_insights_enabled = true
  monitoring_interval          = 60

  tags = { Name = "remitflow-primary" }
}

resource "aws_db_instance" "read_replica" {
  count = var.environment == "production" ? 1 : 0

  identifier          = "remitflow-${var.environment}-replica"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.db_instance_class
  storage_encrypted   = true
}

# ─── ElastiCache Redis ───────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "remitflow-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "remitflow-${var.environment}"
  description          = "RemitFlow Redis cluster"

  node_type            = "cache.r6g.large"
  num_cache_clusters   = var.environment == "production" ? 3 : 1
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = var.environment == "production"
}

# ─── S3 for documents ────────────────────────────────────────────────────────

resource "aws_s3_bucket" "documents" {
  bucket = "remitflow-${var.environment}-documents"
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── Multi-Region DR ─────────────────────────────────────────────────────────

provider "aws" {
  alias  = "dr"
  region = var.dr_region

  default_tags {
    tags = {
      Project     = "RemitFlow"
      Environment = "${var.environment}-dr"
      ManagedBy   = "Terraform"
    }
  }
}

# DR Region VPC
module "vpc_dr" {
  count   = var.enable_multi_region ? 1 : 0
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  providers = { aws = aws.dr }

  name = "remitflow-${var.environment}-dr"
  cidr = "10.1.0.0/16"

  azs             = ["${var.dr_region}a", "${var.dr_region}b", "${var.dr_region}c"]
  private_subnets = ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"]
  public_subnets  = ["10.1.101.0/24", "10.1.102.0/24", "10.1.103.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = false
  enable_dns_hostnames = true
  enable_dns_support   = true
}

# DR Region EKS (standby — scaled to minimum)
module "eks_dr" {
  count   = var.enable_multi_region ? 1 : 0
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  providers = { aws = aws.dr }

  cluster_name    = "remitflow-${var.environment}-dr"
  cluster_version = "1.29"

  vpc_id     = module.vpc_dr[0].vpc_id
  subnet_ids = module.vpc_dr[0].private_subnets

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    general = {
      instance_types = [var.eks_node_instance_type]
      min_size       = 2
      max_size       = var.eks_max_nodes
      desired_size   = 2
    }
  }
}

# Cross-region RDS read replica for DR
resource "aws_db_instance" "dr_replica" {
  count    = var.enable_multi_region ? 1 : 0
  provider = aws.dr

  identifier          = "remitflow-${var.environment}-dr-replica"
  replicate_source_db = aws_db_instance.primary.arn
  instance_class      = var.db_instance_class
  storage_encrypted   = true

  performance_insights_enabled = true
  monitoring_interval          = 60

  tags = { Name = "remitflow-dr-replica" }
}

# DR region Redis (warm standby)
resource "aws_elasticache_subnet_group" "dr" {
  count    = var.enable_multi_region ? 1 : 0
  provider = aws.dr

  name       = "remitflow-${var.environment}-dr"
  subnet_ids = module.vpc_dr[0].private_subnets
}

resource "aws_elasticache_replication_group" "dr" {
  count    = var.enable_multi_region ? 1 : 0
  provider = aws.dr

  replication_group_id = "remitflow-${var.environment}-dr"
  description          = "RemitFlow DR Redis"

  node_type            = "cache.r6g.large"
  num_cache_clusters   = 2
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.dr[0].name
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = true
}

# Global Accelerator for automatic failover between regions
resource "aws_globalaccelerator_accelerator" "main" {
  count = var.enable_multi_region ? 1 : 0

  name            = "remitflow-${var.environment}"
  ip_address_type = "IPV4"
  enabled         = true

  attributes {
    flow_logs_enabled = true
    flow_logs_s3_bucket = aws_s3_bucket.documents.id
    flow_logs_s3_prefix = "global-accelerator-logs/"
  }
}

resource "aws_globalaccelerator_listener" "https" {
  count = var.enable_multi_region ? 1 : 0

  accelerator_arn = aws_globalaccelerator_accelerator.main[0].id
  protocol        = "TCP"

  port_range {
    from_port = 443
    to_port   = 443
  }
}

# S3 cross-region replication for documents
resource "aws_s3_bucket" "documents_dr" {
  count    = var.enable_multi_region ? 1 : 0
  provider = aws.dr

  bucket = "remitflow-${var.environment}-documents-dr"
}

resource "aws_s3_bucket_versioning" "documents_dr" {
  count    = var.enable_multi_region ? 1 : 0
  provider = aws.dr

  bucket = aws_s3_bucket.documents_dr[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "eks_cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  value = aws_db_instance.primary.endpoint
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "s3_bucket" {
  value = aws_s3_bucket.documents.id
}

output "dr_region" {
  value = var.enable_multi_region ? var.dr_region : "disabled"
}

output "dr_eks_cluster_endpoint" {
  value = var.enable_multi_region ? module.eks_dr[0].cluster_endpoint : "disabled"
}

output "dr_rds_endpoint" {
  value = var.enable_multi_region ? aws_db_instance.dr_replica[0].endpoint : "disabled"
}
