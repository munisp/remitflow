output "cluster_id"              { value = aws_rds_cluster.main.id }
output "cluster_endpoint"        { value = aws_rds_cluster.main.endpoint }
output "reader_endpoint"         { value = aws_rds_cluster.main.reader_endpoint }
output "cluster_arn"             { value = aws_rds_cluster.main.arn }
output "global_cluster_id"       { value = var.is_primary ? aws_rds_global_cluster.main[0].id : var.global_cluster_identifier }
output "security_group_id"       { value = aws_security_group.rds.id }
output "kms_key_arn"             { value = aws_kms_key.rds.arn }
output "database_name"           { value = aws_rds_cluster.main.database_name }
