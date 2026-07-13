variable "domain_name"     { type = string }
variable "primary_vpc_id"  { type = string }
variable "regional_endpoints" {
  type = map(object({
    alb_dns_name = string
    alb_zone_id  = string
  }))
}
variable "canary_endpoint" {
  type = object({ alb_dns_name = string; alb_zone_id = string })
  default = null
}
variable "canary_weight"   { type = number; default = 5 }
variable "internal_service_endpoints" { type = map(string); default = {} }
variable "tags"            { type = map(string); default = {} }
