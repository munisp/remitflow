###############################################################################
# RemitFlow — Production Environment
# Active-Active Multi-Region: us-east-1 (primary), eu-west-1, ap-southeast-1
###############################################################################

locals {
  env  = "production"
  name = "remitflow-prod"
  tags = {
    Project     = "RemitFlow"
    Environment = local.env
    ManagedBy   = "Terraform"
    Owner       = "platform-team"
  }
}

# ── Provider Configuration ────────────────────────────────────────────────────
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

provider "aws" {
  alias  = "eu_west_1"
  region = "eu-west-1"
}

provider "aws" {
  alias  = "ap_southeast_1"
  region = "ap-southeast-1"
}

# ══════════════════════════════════════════════════════════════════════════════
# REGION 1: us-east-1 (Primary)
# ══════════════════════════════════════════════════════════════════════════════

module "vpc_us_east_1" {
  source       = "../../modules/vpc"
  providers    = { aws = aws.us_east_1 }
  name         = "${local.name}-use1"
  vpc_cidr     = "10.0.0.0/16"
  cluster_name = "${local.name}-use1"
  tags         = merge(local.tags, { Region = "us-east-1", Role = "primary" })
}

module "eks_us_east_1" {
  source             = "../../modules/eks"
  providers          = { aws = aws.us_east_1 }
  cluster_name       = "${local.name}-use1"
  environment        = local.env
  private_subnet_ids = module.vpc_us_east_1.private_subnet_ids
  public_subnet_ids  = module.vpc_us_east_1.public_subnet_ids
  on_demand_desired  = 5
  on_demand_max      = 20
  spot_desired       = 10
  spot_max           = 50
  tags               = merge(local.tags, { Region = "us-east-1" })
}

module "rds_us_east_1" {
  source               = "../../modules/rds"
  providers            = { aws = aws.us_east_1 }
  cluster_identifier   = "${local.name}-use1"
  vpc_id               = module.vpc_us_east_1.vpc_id
  db_subnet_group_name = module.vpc_us_east_1.db_subnet_group_name
  allowed_cidr_blocks  = [module.vpc_us_east_1.vpc_cidr]
  is_primary           = true
  master_password      = var.db_master_password
  serverless_min_acu   = 2
  serverless_max_acu   = 256
  reader_count         = 2
  environment          = local.env
  tags                 = merge(local.tags, { Region = "us-east-1" })
}

module "redis_us_east_1" {
  source             = "../../modules/elasticache"
  providers          = { aws = aws.us_east_1 }
  cluster_id         = "${local.name}-use1"
  vpc_id             = module.vpc_us_east_1.vpc_id
  subnet_group_name  = module.vpc_us_east_1.cache_subnet_group_name
  allowed_cidr_blocks = [module.vpc_us_east_1.vpc_cidr]
  node_type          = "cache.r7g.xlarge"
  num_cache_nodes    = 3
  environment        = local.env
  tags               = merge(local.tags, { Region = "us-east-1" })
}

# ══════════════════════════════════════════════════════════════════════════════
# REGION 2: eu-west-1 (Secondary — Europe)
# ══════════════════════════════════════════════════════════════════════════════

module "vpc_eu_west_1" {
  source       = "../../modules/vpc"
  providers    = { aws = aws.eu_west_1 }
  name         = "${local.name}-euw1"
  vpc_cidr     = "10.1.0.0/16"
  cluster_name = "${local.name}-euw1"
  tags         = merge(local.tags, { Region = "eu-west-1", Role = "secondary" })
}

module "eks_eu_west_1" {
  source             = "../../modules/eks"
  providers          = { aws = aws.eu_west_1 }
  cluster_name       = "${local.name}-euw1"
  environment        = local.env
  private_subnet_ids = module.vpc_eu_west_1.private_subnet_ids
  public_subnet_ids  = module.vpc_eu_west_1.public_subnet_ids
  on_demand_desired  = 3
  on_demand_max      = 15
  spot_desired       = 5
  spot_max           = 30
  tags               = merge(local.tags, { Region = "eu-west-1" })
}

module "rds_eu_west_1" {
  source                    = "../../modules/rds"
  providers                 = { aws = aws.eu_west_1 }
  cluster_identifier        = "${local.name}-euw1"
  vpc_id                    = module.vpc_eu_west_1.vpc_id
  db_subnet_group_name      = module.vpc_eu_west_1.db_subnet_group_name
  allowed_cidr_blocks       = [module.vpc_eu_west_1.vpc_cidr]
  is_primary                = false
  global_cluster_identifier = module.rds_us_east_1.global_cluster_id
  master_password           = var.db_master_password
  serverless_min_acu        = 1
  serverless_max_acu        = 128
  reader_count              = 1
  environment               = local.env
  tags                      = merge(local.tags, { Region = "eu-west-1" })
}

module "redis_eu_west_1" {
  source             = "../../modules/elasticache"
  providers          = { aws = aws.eu_west_1 }
  cluster_id         = "${local.name}-euw1"
  vpc_id             = module.vpc_eu_west_1.vpc_id
  subnet_group_name  = module.vpc_eu_west_1.cache_subnet_group_name
  allowed_cidr_blocks = [module.vpc_eu_west_1.vpc_cidr]
  node_type          = "cache.r7g.large"
  num_cache_nodes    = 3
  environment        = local.env
  tags               = merge(local.tags, { Region = "eu-west-1" })
}

# ══════════════════════════════════════════════════════════════════════════════
# REGION 3: ap-southeast-1 (Secondary — Asia Pacific)
# ══════════════════════════════════════════════════════════════════════════════

module "vpc_ap_southeast_1" {
  source       = "../../modules/vpc"
  providers    = { aws = aws.ap_southeast_1 }
  name         = "${local.name}-apse1"
  vpc_cidr     = "10.2.0.0/16"
  cluster_name = "${local.name}-apse1"
  tags         = merge(local.tags, { Region = "ap-southeast-1", Role = "secondary" })
}

module "eks_ap_southeast_1" {
  source             = "../../modules/eks"
  providers          = { aws = aws.ap_southeast_1 }
  cluster_name       = "${local.name}-apse1"
  environment        = local.env
  private_subnet_ids = module.vpc_ap_southeast_1.private_subnet_ids
  public_subnet_ids  = module.vpc_ap_southeast_1.public_subnet_ids
  on_demand_desired  = 3
  on_demand_max      = 15
  spot_desired       = 5
  spot_max           = 30
  tags               = merge(local.tags, { Region = "ap-southeast-1" })
}

module "rds_ap_southeast_1" {
  source                    = "../../modules/rds"
  providers                 = { aws = aws.ap_southeast_1 }
  cluster_identifier        = "${local.name}-apse1"
  vpc_id                    = module.vpc_ap_southeast_1.vpc_id
  db_subnet_group_name      = module.vpc_ap_southeast_1.db_subnet_group_name
  allowed_cidr_blocks       = [module.vpc_ap_southeast_1.vpc_cidr]
  is_primary                = false
  global_cluster_identifier = module.rds_us_east_1.global_cluster_id
  master_password           = var.db_master_password
  serverless_min_acu        = 1
  serverless_max_acu        = 128
  reader_count              = 1
  environment               = local.env
  tags                      = merge(local.tags, { Region = "ap-southeast-1" })
}

module "redis_ap_southeast_1" {
  source             = "../../modules/elasticache"
  providers          = { aws = aws.ap_southeast_1 }
  cluster_id         = "${local.name}-apse1"
  vpc_id             = module.vpc_ap_southeast_1.vpc_id
  subnet_group_name  = module.vpc_ap_southeast_1.cache_subnet_group_name
  allowed_cidr_blocks = [module.vpc_ap_southeast_1.vpc_cidr]
  node_type          = "cache.r7g.large"
  num_cache_nodes    = 3
  environment        = local.env
  tags               = merge(local.tags, { Region = "ap-southeast-1" })
}

# ══════════════════════════════════════════════════════════════════════════════
# GLOBAL: Route53 Active-Active DNS
# ══════════════════════════════════════════════════════════════════════════════

module "route53" {
  source         = "../../modules/route53"
  domain_name    = var.domain_name
  primary_vpc_id = module.vpc_us_east_1.vpc_id

  regional_endpoints = {
    "us-east-1" = {
      alb_dns_name = var.alb_dns_us_east_1
      alb_zone_id  = var.alb_zone_us_east_1
    }
    "eu-west-1" = {
      alb_dns_name = var.alb_dns_eu_west_1
      alb_zone_id  = var.alb_zone_eu_west_1
    }
    "ap-southeast-1" = {
      alb_dns_name = var.alb_dns_ap_southeast_1
      alb_zone_id  = var.alb_zone_ap_southeast_1
    }
  }

  tags = local.tags
}

# ══════════════════════════════════════════════════════════════════════════════
# GLOBAL: Immutable Cross-Region Backup and Restore Storage
# ══════════════════════════════════════════════════════════════════════════════
module "backup_dr" {
  source = "../../modules/backup-dr"
  providers = {
    aws.primary = aws.us_east_1
    aws.replica = aws.eu_west_1
  }

  name                               = local.name
  primary_bucket_name                = var.backup_primary_bucket_name
  replica_bucket_name                = var.backup_replica_bucket_name
  object_lock_retention_days         = var.backup_object_lock_retention_days
  glacier_transition_days            = 90
  noncurrent_version_expiration_days = 2555
  tags                               = merge(local.tags, { Control = "immutable-backup", RPO = "15m", RTO = "4h" })
}
