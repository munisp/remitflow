# Production Environment Configuration

environment = "production"
aws_region  = "eu-west-1"

# VPC
vpc_cidr = "10.0.0.0/16"

# Domain
domain_name = "remittance-platform.com"

# EKS
eks_cluster_version     = "1.28"
eks_node_desired_size   = 3
eks_node_min_size       = 2
eks_node_max_size       = 10
eks_node_instance_types = ["m5.large", "m5a.large"]

# Database
db_instance_class    = "db.r6g.large"
db_allocated_storage = 100

# Redis
redis_node_type       = "cache.r6g.large"
redis_num_cache_nodes = 3

# Kafka
kafka_broker_count  = 3
kafka_instance_type = "kafka.m5.large"

# Monitoring
alarm_email_endpoints = [
  "ops@remittance-platform.com",
  "oncall@remittance-platform.com"
]

# Tags
tags = {
  CostCenter  = "platform-infrastructure"
  Compliance  = "pci-dss"
  DataClass   = "confidential"
}
