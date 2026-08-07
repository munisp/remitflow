variable "db_master_password"     { type = string; sensitive = true }
variable "domain_name"            { type = string; default = "remitflow.io" }
variable "alb_dns_us_east_1"      { type = string }
variable "alb_zone_us_east_1"     { type = string }
variable "alb_dns_eu_west_1"      { type = string }
variable "alb_zone_eu_west_1"     { type = string }
variable "alb_dns_ap_southeast_1" { type = string }
variable "alb_zone_ap_southeast_1"{ type = string }

variable "backup_primary_bucket_name" {
  type        = string
  description = "Globally unique primary immutable backup bucket name in us-east-1."
}

variable "backup_replica_bucket_name" {
  type        = string
  description = "Globally unique immutable backup replica bucket name in eu-west-1."
}

variable "backup_object_lock_retention_days" {
  type        = number
  description = "Compliance-mode retention period for all backup objects."
  default     = 2555
}
