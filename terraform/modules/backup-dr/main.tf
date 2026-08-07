terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      configuration_aliases = [aws.primary, aws.replica]
    }
  }
}

resource "aws_kms_key" "primary" {
  provider                = aws.primary
  description             = "${var.name} immutable backup encryption key (primary)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = merge(var.tags, { Role = "backup-primary" })
}

resource "aws_kms_alias" "primary" {
  provider      = aws.primary
  name          = "alias/${var.name}-backup-primary"
  target_key_id = aws_kms_key.primary.key_id
}

resource "aws_kms_key" "replica" {
  provider                = aws.replica
  description             = "${var.name} immutable backup encryption key (replica)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  tags                    = merge(var.tags, { Role = "backup-replica" })
}

resource "aws_kms_alias" "replica" {
  provider      = aws.replica
  name          = "alias/${var.name}-backup-replica"
  target_key_id = aws_kms_key.replica.key_id
}

resource "aws_s3_bucket" "replica" {
  provider            = aws.replica
  bucket              = var.replica_bucket_name
  object_lock_enabled = true
  tags                = merge(var.tags, { Role = "backup-replica" })
}

resource "aws_s3_bucket_public_access_block" "replica" {
  provider                = aws.replica
  bucket                  = aws_s3_bucket.replica.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.replica.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.replica.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.replica.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.replica.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_object_lock_configuration" "replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.replica.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.object_lock_retention_days
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "replica" {
  provider = aws.replica
  bucket   = aws_s3_bucket.replica.id
  rule {
    id     = "retain-immutable-backups"
    status = "Enabled"
    filter {}
    transition { days = var.glacier_transition_days storage_class = "DEEP_ARCHIVE" }
    noncurrent_version_expiration { noncurrent_days = var.noncurrent_version_expiration_days }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

resource "aws_s3_bucket" "primary" {
  provider            = aws.primary
  bucket              = var.primary_bucket_name
  object_lock_enabled = true
  tags                = merge(var.tags, { Role = "backup-primary" })
}

resource "aws_s3_bucket_public_access_block" "primary" {
  provider                = aws.primary
  bucket                  = aws_s3_bucket.primary.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_versioning" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.primary.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_object_lock_configuration" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id
  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.object_lock_retention_days
    }
  }
}

resource "aws_iam_role" "replication" {
  provider = aws.primary
  name     = "${var.name}-backup-replication"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "s3.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "replication" {
  provider = aws.primary
  role     = aws_iam_role.replication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetReplicationConfiguration", "s3:ListBucket"], Resource = aws_s3_bucket.primary.arn },
      { Effect = "Allow", Action = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectVersionTagging", "s3:GetObjectRetention", "s3:GetObjectLegalHold"], Resource = "${aws_s3_bucket.primary.arn}/*" },
      { Effect = "Allow", Action = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ReplicateTags", "s3:ObjectOwnerOverrideToBucketOwner"], Resource = "${aws_s3_bucket.replica.arn}/*" },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = aws_kms_key.primary.arn },
      { Effect = "Allow", Action = ["kms:Encrypt"], Resource = aws_kms_key.replica.arn }
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "primary" {
  provider = aws.primary
  depends_on = [
    aws_s3_bucket_versioning.primary,
    aws_s3_bucket_versioning.replica,
    aws_iam_role_policy.replication,
  ]
  bucket = aws_s3_bucket.primary.id
  role   = aws_iam_role.replication.arn
  rule {
    id     = "replicate-all-immutable-backups"
    status = "Enabled"
    filter {}
    destination {
      bucket        = aws_s3_bucket.replica.arn
      storage_class = "STANDARD"
      encryption_configuration { replica_kms_key_id = aws_kms_key.replica.arn }
      access_control_translation { owner = "Destination" }
    }
    delete_marker_replication { status = "Enabled" }
    source_selection_criteria {
      sse_kms_encrypted_objects { status = "Enabled" }
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "primary" {
  provider = aws.primary
  bucket   = aws_s3_bucket.primary.id
  rule {
    id     = "retain-immutable-backups"
    status = "Enabled"
    filter {}
    transition { days = var.glacier_transition_days storage_class = "DEEP_ARCHIVE" }
    noncurrent_version_expiration { noncurrent_days = var.noncurrent_version_expiration_days }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}
