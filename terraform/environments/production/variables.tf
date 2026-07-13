variable "db_master_password"     { type = string; sensitive = true }
variable "domain_name"            { type = string; default = "remitflow.io" }
variable "alb_dns_us_east_1"      { type = string }
variable "alb_zone_us_east_1"     { type = string }
variable "alb_dns_eu_west_1"      { type = string }
variable "alb_zone_eu_west_1"     { type = string }
variable "alb_dns_ap_southeast_1" { type = string }
variable "alb_zone_ap_southeast_1"{ type = string }
