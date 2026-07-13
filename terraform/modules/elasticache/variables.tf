variable "cluster_id"          { type = string }
variable "vpc_id"              { type = string }
variable "subnet_group_name"   { type = string }
variable "allowed_cidr_blocks" { type = list(string) }
variable "node_type"           { type = string; default = "cache.r7g.large" }
variable "num_cache_nodes"     { type = number; default = 3 }
variable "engine_version"      { type = string; default = "7.1" }
variable "environment"         { type = string }
variable "tags"                { type = map(string); default = {} }
