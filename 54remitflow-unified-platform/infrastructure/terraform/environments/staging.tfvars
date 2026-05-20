# Staging Environment Configuration

environment = "staging"
aws_region  = "eu-west-1"

# VPC
vpc_cidr = "10.1.0.0/16"

# Domain
domain_name = "staging.remittance-platform.com"

# EKS
eks_cluster_version     = "1.28"
eks_node_desired_size   = 2
eks_node_min_size       = 1
eks_node_max_size       = 5
eks_node_instance_types = ["m5.large"]

# Database
db_instance_class    = "db.t3.medium"
db_allocated_storage = 50

# Redis
redis_node_type       = "cache.t3.medium"
redis_num_cache_nodes = 2

# Kafka
kafka_broker_count  = 2
kafka_instance_type = "kafka.t3.small"

# Monitoring
alarm_email_endpoints = [
  "staging-alerts@remittance-platform.com"
]

# Tags
tags = {
  CostCenter = "platform-staging"
}
