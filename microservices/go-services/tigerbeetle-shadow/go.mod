module remitflow/tigerbeetle-shadow

go 1.22

// Real TigerBeetle client — pinned to match the deployed server image
// ghcr.io/tigerbeetle/tigerbeetle:0.16.63.
require github.com/tigerbeetle/tigerbeetle-go v0.16.63
