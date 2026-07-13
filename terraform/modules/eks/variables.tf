variable "cluster_name"           { type = string }
variable "kubernetes_version"     { type = string; default = "1.29" }
variable "environment"            { type = string }
variable "private_subnet_ids"     { type = list(string) }
variable "public_subnet_ids"      { type = list(string) }
variable "public_access"          { type = bool; default = false }
variable "public_access_cidrs"    { type = list(string); default = [] }
variable "on_demand_instance_types" { type = list(string); default = ["m6i.xlarge", "m6a.xlarge"] }
variable "spot_instance_types"    { type = list(string); default = ["m6i.large", "m6a.large", "m5.large", "m5a.large"] }
variable "on_demand_desired"      { type = number; default = 3 }
variable "on_demand_min"          { type = number; default = 3 }
variable "on_demand_max"          { type = number; default = 10 }
variable "spot_desired"           { type = number; default = 5 }
variable "spot_min"               { type = number; default = 0 }
variable "spot_max"               { type = number; default = 30 }
variable "tags"                   { type = map(string); default = {} }
