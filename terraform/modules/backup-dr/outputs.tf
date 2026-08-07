output "primary_backup_bucket" {
  value       = aws_s3_bucket.primary.id
  description = "Primary immutable backup bucket."
}

output "replica_backup_bucket" {
  value       = aws_s3_bucket.replica.id
  description = "Cross-region immutable backup replica bucket."
}

output "primary_backup_kms_key_arn" {
  value       = aws_kms_key.primary.arn
  description = "Primary KMS key used for backup encryption."
}

output "replica_backup_kms_key_arn" {
  value       = aws_kms_key.replica.arn
  description = "Replica KMS key used for backup encryption."
}
