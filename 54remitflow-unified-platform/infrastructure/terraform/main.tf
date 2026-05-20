# Nigerian Remittance Platform - Terraform Infrastructure
# Main configuration for AWS deployment

terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
  }
  
  backend "s3" {
    bucket         = "remittance-platform-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "eu-west-1"
    encrypt        = true
    dynamodb_table = "terraform-state-lock"
  }
}

provider "aws" {
  region = var.aws_region
  
  default_tags {
    tags = {
      Project     = "nigerian-remittance-platform"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Data sources
data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

# VPC Module
module "vpc" {
  source = "./modules/vpc"
  
  environment         = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = data.aws_availability_zones.available.names
  
  enable_nat_gateway = true
  single_nat_gateway = var.environment != "production"
  
  tags = var.tags
}

# EKS Cluster
module "eks" {
  source = "./modules/eks"
  
  cluster_name    = "${var.project_name}-${var.environment}"
  cluster_version = var.eks_cluster_version
  
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnet_ids
  
  node_groups = {
    general = {
      desired_size = var.environment == "production" ? 3 : 2
      min_size     = var.environment == "production" ? 2 : 1
      max_size     = var.environment == "production" ? 10 : 5
      
      instance_types = ["m5.large"]
      capacity_type  = "ON_DEMAND"
    }
    
    spot = {
      desired_size = var.environment == "production" ? 2 : 1
      min_size     = 0
      max_size     = var.environment == "production" ? 20 : 10
      
      instance_types = ["m5.large", "m5a.large", "m5n.large"]
      capacity_type  = "SPOT"
    }
  }
  
  tags = var.tags
}

# RDS PostgreSQL
module "rds" {
  source = "./modules/rds"
  
  identifier     = "${var.project_name}-${var.environment}"
  engine_version = "15.4"
  
  instance_class = var.environment == "production" ? "db.r6g.large" : "db.t3.medium"
  
  allocated_storage     = var.environment == "production" ? 100 : 20
  max_allocated_storage = var.environment == "production" ? 500 : 100
  
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.private_subnet_ids
  security_group_ids = [module.vpc.database_security_group_id]
  
  multi_az               = var.environment == "production"
  backup_retention_period = var.environment == "production" ? 30 : 7
  
  tags = var.tags
}

# ElastiCache Redis
module "redis" {
  source = "./modules/redis"
  
  cluster_id         = "${var.project_name}-${var.environment}"
  node_type          = var.environment == "production" ? "cache.r6g.large" : "cache.t3.medium"
  num_cache_nodes    = var.environment == "production" ? 3 : 1
  
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.private_subnet_ids
  security_group_ids = [module.vpc.cache_security_group_id]
  
  tags = var.tags
}

# MSK Kafka
module "msk" {
  source = "./modules/msk"
  
  cluster_name   = "${var.project_name}-${var.environment}"
  kafka_version  = "3.5.1"
  
  number_of_broker_nodes = var.environment == "production" ? 3 : 2
  broker_instance_type   = var.environment == "production" ? "kafka.m5.large" : "kafka.t3.small"
  
  vpc_id             = module.vpc.vpc_id
  subnet_ids         = module.vpc.private_subnet_ids
  security_group_ids = [module.vpc.kafka_security_group_id]
  
  ebs_volume_size = var.environment == "production" ? 500 : 100
  
  tags = var.tags
}

# S3 Buckets
module "s3" {
  source = "./modules/s3"
  
  environment = var.environment
  
  buckets = {
    documents = {
      name = "${var.project_name}-documents-${var.environment}"
      versioning = true
      encryption = true
    }
    
    lakehouse = {
      name = "${var.project_name}-lakehouse-${var.environment}"
      versioning = true
      encryption = true
      lifecycle_rules = [
        {
          id = "archive-old-data"
          transition_days = 90
          storage_class = "GLACIER"
        }
      ]
    }
    
    backups = {
      name = "${var.project_name}-backups-${var.environment}"
      versioning = true
      encryption = true
      lifecycle_rules = [
        {
          id = "delete-old-backups"
          expiration_days = 365
        }
      ]
    }
  }
  
  tags = var.tags
}

# Secrets Manager
module "secrets" {
  source = "./modules/secrets"
  
  environment = var.environment
  
  secrets = {
    database = {
      name = "${var.project_name}/${var.environment}/database"
      description = "Database credentials"
    }
    
    corridors = {
      name = "${var.project_name}/${var.environment}/corridors"
      description = "Payment corridor API keys"
    }
    
    jwt = {
      name = "${var.project_name}/${var.environment}/jwt"
      description = "JWT signing keys"
    }
  }
  
  tags = var.tags
}

# CloudWatch Alarms
module "monitoring" {
  source = "./modules/monitoring"
  
  environment = var.environment
  
  eks_cluster_name = module.eks.cluster_name
  rds_identifier   = module.rds.identifier
  redis_cluster_id = module.redis.cluster_id
  msk_cluster_arn  = module.msk.cluster_arn
  
  alarm_sns_topic_arn = module.sns.alarm_topic_arn
  
  tags = var.tags
}

# SNS Topics
module "sns" {
  source = "./modules/sns"
  
  environment = var.environment
  
  topics = {
    alarms = {
      name = "${var.project_name}-alarms-${var.environment}"
      subscriptions = var.alarm_email_endpoints
    }
    
    transactions = {
      name = "${var.project_name}-transactions-${var.environment}"
    }
  }
  
  tags = var.tags
}

# WAF for API Gateway
module "waf" {
  source = "./modules/waf"
  
  environment = var.environment
  name_prefix = var.project_name
  
  rate_limit = var.environment == "production" ? 10000 : 1000
  
  blocked_countries = ["KP", "IR", "SY", "CU"]
  
  tags = var.tags
}

# Route53 DNS
module "dns" {
  source = "./modules/dns"
  
  domain_name = var.domain_name
  environment = var.environment
  
  create_certificate = true
  
  records = {
    api = {
      type = "A"
      alias = {
        name    = module.eks.load_balancer_hostname
        zone_id = module.eks.load_balancer_zone_id
      }
    }
  }
  
  tags = var.tags
}

# Outputs
output "vpc_id" {
  value = module.vpc.vpc_id
}

output "eks_cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "rds_endpoint" {
  value     = module.rds.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value     = module.redis.endpoint
  sensitive = true
}

output "msk_bootstrap_brokers" {
  value     = module.msk.bootstrap_brokers
  sensitive = true
}

output "s3_bucket_arns" {
  value = module.s3.bucket_arns
}
