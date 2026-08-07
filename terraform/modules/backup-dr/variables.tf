variable "name" {
  type        = string
  description = "Stable lowercase prefix for backup resources."
}

variable "primary_bucket_name" {
  type        = string
  description = "Globally unique primary S3 backup bucket name."
}

variable "replica_bucket_name" {
  type        = string
  description = "Globally unique replica S3 backup bucket name."
}

variable "object_lock_retention_days" {
  type        = number
  description = "Compliance-mode Object Lock retention for every backup object version."
  validation {
    condition     = var.object_lock_retention_days >= 30
    error_message = "Object Lock retention must be at least 30 days for recoverable regulated backup history."
  }
}

variable "glacier_transition_days" {
  type        = number
  description = "Days before immutable backups transition to deep archive."
  default     = 90
}

variable "noncurrent_version_expiration_days" {
  type        = number
  description = "Days before noncurrent backup versions may expire after Object Lock has elapsed."
  default     = 2555
}

variable "tags" {
  type        = map(string)
  description = "Mandatory resource tags."
}
