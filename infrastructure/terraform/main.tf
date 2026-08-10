# RemitFlow Multi-Region Infrastructure (Terraform)
# Deploys to EU (GDPR) and US (FinCEN) regions

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# EU Provider
provider "aws" {
  alias  = "eu"
  region = "eu-west-1"
}

# US Provider
provider "aws" {
  alias  = "us"
  region = "us-east-1"
}

# ─── EU Region ────────────────────────────────────────────────────────────────
module "eu_vpc" {
  source = "terraform-aws-modules/vpc/aws"
  providers = { aws = aws.eu }

  name = "remitflow-eu-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway = true
  enable_vpn_gateway = false

  tags = {
    Region      = "EU"
    Compliance  = "GDPR"
    Environment = "production"
  }
}

module "eu_eks" {
  source = "terraform-aws-modules/eks/aws"
  providers = { aws = aws.eu }

  cluster_name    = "remitflow-eu"
  cluster_version = "1.29"

  vpc_id     = module.eu_vpc.vpc_id
  subnet_ids = module.eu_vpc.private_subnets

  eks_managed_node_groups = {
    general = {
      desired_size = 3
      min_size     = 2
      max_size     = 10

      instance_types = ["m6i.xlarge"]
      capacity_type  = "ON_DEMAND"

      labels = {
        workload = "general"
      }
    }
  }

  tags = {
    Region      = "EU"
    Compliance  = "GDPR"
  }
}

module "eu_rds" {
  source = "terraform-aws-modules/rds/aws"
  providers = { aws = aws.eu }

  identifier = "remitflow-eu-db"

  engine               = "postgres"
  engine_version       = "16.1"
  family               = "postgres16"
  major_engine_version = "16"
  instance_class       = "db.r6g.xlarge"

  allocated_storage     = 100
  max_allocated_storage = 1000

  db_name  = "remitflow"
  username = "remitflow_admin"
  port     = 5432

  multi_az               = true
  db_subnet_group_name   = module.eu_vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.eu_rds.id]

  backup_retention_period = 35
  backup_window          = "03:00-04:00"
  maintenance_window     = "Mon:04:00-Mon:05:00"

  storage_encrypted = true
  kms_key_id        = aws_kms_key.eu_db.arn

  deletion_protection = true

  tags = {
    Region      = "EU"
    Compliance  = "GDPR"
  }
}

resource "aws_kms_key" "eu_db" {
  provider = aws.eu

  description             = "KMS key for EU database encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Region      = "EU"
    Compliance  = "GDPR"
  }
}

# ─── US Region ────────────────────────────────────────────────────────────────
module "us_vpc" {
  source = "terraform-aws-modules/vpc/aws"
  providers = { aws = aws.us }

  name = "remitflow-us-vpc"
  cidr = "10.1.0.0/16"

  azs             = ["us-east-1a", "us-east-1b", "us-east-1c"]
  private_subnets = ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"]
  public_subnets  = ["10.1.101.0/24", "10.1.102.0/24", "10.1.103.0/24"]

  enable_nat_gateway = true
  enable_vpn_gateway = false

  tags = {
    Region      = "US"
    Compliance  = "FinCEN"
    Environment = "production"
  }
}

module "us_eks" {
  source = "terraform-aws-modules/eks/aws"
  providers = { aws = aws.us }

  cluster_name    = "remitflow-us"
  cluster_version = "1.29"

  vpc_id     = module.us_vpc.vpc_id
  subnet_ids = module.us_vpc.private_subnets

  eks_managed_node_groups = {
    general = {
      desired_size = 3
      min_size     = 2
      max_size     = 10

      instance_types = ["m6i.xlarge"]
      capacity_type  = "ON_DEMAND"

      labels = {
        workload = "general"
      }
    }
  }

  tags = {
    Region      = "US"
    Compliance  = "FinCEN"
  }
}

module "us_rds" {
  source = "terraform-aws-modules/rds/aws"
  providers = { aws = aws.us }

  identifier = "remitflow-us-db"

  engine               = "postgres"
  engine_version       = "16.1"
  family               = "postgres16"
  major_engine_version = "16"
  instance_class       = "db.r6g.xlarge"

  allocated_storage     = 100
  max_allocated_storage = 1000

  db_name  = "remitflow"
  username = "remitflow_admin"
  port     = 5432

  multi_az               = true
  db_subnet_group_name   = module.us_vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.us_rds.id]

  backup_retention_period = 35
  backup_window          = "03:00-04:00"
  maintenance_window     = "Mon:04:00-Mon:05:00"

  storage_encrypted = true
  kms_key_id        = aws_kms_key.us_db.arn

  deletion_protection = true

  tags = {
    Region      = "US"
    Compliance  = "FinCEN"
  }
}

resource "aws_kms_key" "us_db" {
  provider = aws.us

  description             = "KMS key for US database encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Region      = "US"
    Compliance  = "FinCEN"
  }
}

# ─── Cross-Region Replication ──────────────────────────────────────────────────
resource "aws_dms_replication_instance" "eu_to_us" {
  provider = aws.eu

  replication_instance_class = "dms.c5.xlarge"
  replication_instance_id    = "remitflow-eu-to-us"

  allocated_storage = 100

  vpc_security_group_ids = [aws_security_group.eu_dms.id]

  tags = {
    Purpose = "cross_region_replication"
    Direction = "eu_to_us"
  }
}

# ─── Route 53 Global Traffic Manager ──────────────────────────────────────────
resource "aws_route53_zone" "primary" {
  name = "remitflow.com"
}

resource "aws_route53_record" "eu" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = "api.eu.remitflow.com"
  type    = "A"

  alias {
    name                   = module.eu_eks.cluster_endpoint
    zone_id                = "Z32O12XQLNTSW2"  # EU ELB zone ID
    evaluate_target_health = true
  }

  geolocation_routing_policy {
    continent = "EU"
  }
}

resource "aws_route53_record" "us" {
  zone_id = aws_route53_zone.primary.zone_id
  name    = "api.us.remitflow.com"
  type    = "A"

  alias {
    name                   = module.us_eks.cluster_endpoint
    zone_id                = "Z35SXDOTRQ7X7K"  # US ELB zone ID
    evaluate_target_health = true
  }

  geolocation_routing_policy {
    country = "US"
  }
}
