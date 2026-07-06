environment = "production"
domain      = "remitflow.app"

db_instance_class = "db.r6g.xlarge"

regions = {
  "ca-central-1" = {
    primary    = true
    cidr       = "10.0.0.0/16"
    azs        = ["ca-central-1a", "ca-central-1b", "ca-central-1d"]
    node_count = 3
    node_type  = "m6i.xlarge"
  }
  "eu-west-1" = {
    primary    = false
    cidr       = "10.1.0.0/16"
    azs        = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
    node_count = 3
    node_type  = "m6i.xlarge"
  }
  "af-south-1" = {
    primary    = false
    cidr       = "10.2.0.0/16"
    azs        = ["af-south-1a", "af-south-1b", "af-south-1c"]
    node_count = 3
    node_type  = "m6i.large"
  }
}
