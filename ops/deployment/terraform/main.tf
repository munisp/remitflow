# RemitFlow — Multi-Region Production Infrastructure
#
# Deploys:
#   - 3 regional EKS clusters (ca-central-1, eu-west-1, af-south-1)
#   - Multi-region RDS Aurora PostgreSQL (Global Database)
#   - ElastiCache Redis (per region)
#   - MSK Kafka (per region)
#   - Vault (HA, Raft storage)
#   - CloudFront CDN + WAF
#   - Route53 GeoDNS
#
# Usage:
#   terraform init
#   terraform plan -var-file=production.tfvars
#   terraform apply -var-file=production.tfvars

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }

  backend "s3" {
    bucket         = "remitflow-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "ca-central-1"
    encrypt        = true
    dynamodb_table = "remitflow-terraform-locks"
  }
}

# ── Variables ──────────────────────────────────────────────────────────────────

variable "environment" {
  type    = string
  default = "production"
}

variable "regions" {
  type = map(object({
    primary    = bool
    cidr       = string
    azs        = list(string)
    node_count = number
    node_type  = string
  }))
  default = {
    "ca-central-1" = {
      primary    = true
      cidr       = "10.0.0.0/16"
      azs        = ["ca-central-1a", "ca-central-1b", "ca-central-1d"]
      node_count = 3
      node_type  = "m6i.xlarge"
    }
    "eu-west-1" = {
      primary    = false
      cidr       = "10.1.0.0/16"
      azs        = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
      node_count = 3
      node_type  = "m6i.xlarge"
    }
    "af-south-1" = {
      primary    = false
      cidr       = "10.2.0.0/16"
      azs        = ["af-south-1a", "af-south-1b", "af-south-1c"]
      node_count = 3
      node_type  = "m6i.large"
    }
  }
}

variable "db_instance_class" {
  type    = string
  default = "db.r6g.xlarge"
}

variable "domain" {
  type    = string
  default = "remitflow.app"
}

# ── Provider Configuration ─────────────────────────────────────────────────────

provider "aws" {
  region = "ca-central-1"
  alias  = "primary"

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "remitflow"
      ManagedBy   = "terraform"
    }
  }
}

provider "aws" {
  region = "eu-west-1"
  alias  = "eu"
}

provider "aws" {
  region = "af-south-1"
  alias  = "africa"
}

# ── VPC per Region ─────────────────────────────────────────────────────────────

module "vpc_ca" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.5.0"

  providers = { aws = aws.primary }

  name = "remitflow-${var.environment}-ca"
  cidr = var.regions["ca-central-1"].cidr

  azs             = var.regions["ca-central-1"].azs
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway     = false
  one_nat_gateway_per_az = true

  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    "kubernetes.io/cluster/remitflow-${var.environment}-ca" = "shared"
  }
}

module "vpc_eu" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.5.0"

  providers = { aws = aws.eu }

  name = "remitflow-${var.environment}-eu"
  cidr = var.regions["eu-west-1"].cidr

  azs             = var.regions["eu-west-1"].azs
  private_subnets = ["10.1.1.0/24", "10.1.2.0/24", "10.1.3.0/24"]
  public_subnets  = ["10.1.101.0/24", "10.1.102.0/24", "10.1.103.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway     = false
  one_nat_gateway_per_az = true

  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    "kubernetes.io/cluster/remitflow-${var.environment}-eu" = "shared"
  }
}

module "vpc_af" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.5.0"

  providers = { aws = aws.africa }

  name = "remitflow-${var.environment}-af"
  cidr = var.regions["af-south-1"].cidr

  azs             = var.regions["af-south-1"].azs
  private_subnets = ["10.2.1.0/24", "10.2.2.0/24", "10.2.3.0/24"]
  public_subnets  = ["10.2.101.0/24", "10.2.102.0/24", "10.2.103.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway     = false
  one_nat_gateway_per_az = true

  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    "kubernetes.io/cluster/remitflow-${var.environment}-af" = "shared"
  }
}

# ── EKS Clusters ──────────────────────────────────────────────────────────────

module "eks_ca" {
  source  = "terraform-aws-modules/eks/aws"
  version = "20.2.0"

  providers = { aws = aws.primary }

  cluster_name    = "remitflow-${var.environment}-ca"
  cluster_version = "1.29"

  vpc_id     = module.vpc_ca.vpc_id
  subnet_ids = module.vpc_ca.private_subnets

  cluster_endpoint_public_access = false

  eks_managed_node_groups = {
    general = {
      instance_types = [var.regions["ca-central-1"].node_type]
      min_size       = var.regions["ca-central-1"].node_count
      max_size       = var.regions["ca-central-1"].node_count * 3
      desired_size   = var.regions["ca-central-1"].node_count

      labels = {
        role = "general"
      }
    }

    financial = {
      instance_types = ["c6i.2xlarge"]
      min_size       = 2
      max_size       = 6
      desired_size   = 2

      labels = {
        role = "financial"
      }

      taints = [{
        key    = "workload"
        value  = "financial"
        effect = "NO_SCHEDULE"
      }]
    }
  }

  cluster_addons = {
    coredns    = { most_recent = true }
    kube-proxy = { most_recent = true }
    vpc-cni    = { most_recent = true }
  }
}

# ── Aurora Global Database ─────────────────────────────────────────────────────

resource "aws_rds_global_cluster" "remitflow" {
  provider = aws.primary

  global_cluster_identifier = "remitflow-${var.environment}"
  engine                    = "aurora-postgresql"
  engine_version            = "16.1"
  database_name             = "remitflow"
  storage_encrypted         = true
}

resource "aws_rds_cluster" "primary" {
  provider = aws.primary

  cluster_identifier        = "remitflow-${var.environment}-ca"
  global_cluster_identifier = aws_rds_global_cluster.remitflow.id
  engine                    = "aurora-postgresql"
  engine_version            = "16.1"
  database_name             = "remitflow"
  master_username           = "remitflow_admin"
  manage_master_user_password = true

  vpc_security_group_ids = [aws_security_group.db_ca.id]
  db_subnet_group_name   = aws_db_subnet_group.ca.name

  backup_retention_period   = 35
  preferred_backup_window   = "03:00-04:00"
  deletion_protection       = true
  copy_tags_to_snapshot     = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "remitflow-${var.environment}-final"

  enabled_cloudwatch_logs_exports = ["postgresql"]
}

resource "aws_rds_cluster_instance" "primary" {
  provider = aws.primary
  count    = 2

  identifier         = "remitflow-${var.environment}-ca-${count.index}"
  cluster_identifier = aws_rds_cluster.primary.id
  instance_class     = var.db_instance_class
  engine             = "aurora-postgresql"
  engine_version     = "16.1"

  performance_insights_enabled = true
  monitoring_interval          = 15
}

# ── Security Groups ────────────────────────────────────────────────────────────

resource "aws_security_group" "db_ca" {
  provider = aws.primary

  name_prefix = "remitflow-db-ca-"
  vpc_id      = module.vpc_ca.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks_ca.cluster_security_group_id]
    description     = "PostgreSQL from EKS"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_subnet_group" "ca" {
  provider = aws.primary

  name       = "remitflow-${var.environment}-ca"
  subnet_ids = module.vpc_ca.private_subnets
}

# ── CloudFront + WAF ──────────────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "main" {
  provider = aws.primary

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_All"
  web_acl_id          = aws_wafv2_web_acl.main.arn

  aliases = [var.domain, "www.${var.domain}"]

  origin {
    domain_name = "api.${var.domain}"
    origin_id   = "api"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "api"

    forwarded_values {
      query_string = true
      headers      = ["Authorization", "Content-Type"]

      cookies {
        forward = "all"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.main.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# ── WAF Rules ─────────────────────────────────────────────────────────────────

resource "aws_wafv2_web_acl" "main" {
  provider = aws.primary

  name        = "remitflow-${var.environment}"
  scope       = "CLOUDFRONT"
  description = "RemitFlow WAF rules"

  default_action {
    allow {}
  }

  # Rate limiting
  rule {
    name     = "rate-limit"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "remitflow-rate-limit"
    }
  }

  # AWS Managed Rules — Common
  rule {
    name     = "aws-common"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "remitflow-aws-common"
    }
  }

  # AWS Managed Rules — Known Bad Inputs
  rule {
    name     = "aws-bad-inputs"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "remitflow-bad-inputs"
    }
  }

  # AWS Managed Rules — SQL Injection
  rule {
    name     = "aws-sqli"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "remitflow-sqli"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = "remitflow-waf"
  }
}

# ── ACM Certificate ───────────────────────────────────────────────────────────

resource "aws_acm_certificate" "main" {
  provider = aws.primary

  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# ── Route53 GeoDNS ────────────────────────────────────────────────────────────

resource "aws_route53_zone" "main" {
  provider = aws.primary
  name     = var.domain
}

resource "aws_route53_record" "api_geo_ca" {
  provider = aws.primary

  zone_id = aws_route53_zone.main.zone_id
  name    = "api.${var.domain}"
  type    = "A"

  set_identifier = "ca"
  geolocation_routing_policy {
    country = "CA"
  }

  alias {
    name                   = "ca-alb.${var.domain}"
    zone_id                = "Z1234567890" # ALB zone ID
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "api_geo_eu" {
  provider = aws.primary

  zone_id = aws_route53_zone.main.zone_id
  name    = "api.${var.domain}"
  type    = "A"

  set_identifier = "eu"
  geolocation_routing_policy {
    continent = "EU"
  }

  alias {
    name                   = "eu-alb.${var.domain}"
    zone_id                = "Z0987654321" # ALB zone ID
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "api_geo_af" {
  provider = aws.primary

  zone_id = aws_route53_zone.main.zone_id
  name    = "api.${var.domain}"
  type    = "A"

  set_identifier = "af"
  geolocation_routing_policy {
    continent = "AF"
  }

  alias {
    name                   = "af-alb.${var.domain}"
    zone_id                = "Z1122334455" # ALB zone ID
    evaluate_target_health = true
  }
}

# ── Outputs ────────────────────────────────────────────────────────────────────

output "eks_cluster_ca" {
  value = module.eks_ca.cluster_endpoint
}

output "rds_endpoint" {
  value = aws_rds_cluster.primary.endpoint
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.main.domain_name
}
