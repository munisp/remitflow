module github.com/remitflow/ledger-service

go 1.22

require (
	github.com/google/uuid v1.6.0
	github.com/lib/pq v1.12.3
)

require github.com/remitflow/shared-middleware v0.0.0

replace github.com/remitflow/shared-middleware => ../shared-middleware
