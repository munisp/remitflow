variable "cluster_identifier"       { type = string }
variable "vpc_id"                   { type = string }
variable "db_subnet_group_name"     { type = string }
variable "allowed_cidr_blocks"      { type = list(string) }
variable "is_primary"               { type = bool; default = true }
variable "global_cluster_identifier" { type = string; default = "" }
variable "database_name"            { type = string; default = "remitflow" }
variable "master_username"          { type = string; default = "remitflow_admin" }
variable "master_password"          { type = string; sensitive = true }
variable "engine_version"           { type = string; default = "15.4" }
variable "serverless_min_acu"       { type = number; default = 0.5 }
variable "serverless_max_acu"       { type = number; default = 128 }
variable "reader_count"             { type = number; default = 1 }
variable "backup_retention_days"    { type = number; default = 35 }
variable "deletion_protection"      { type = bool; default = true }
variable "environment"              { type = string }
variable "tags"                     { type = map(string); default = {} }
