#!/bin/bash

NS="54remit"

kubectl apply -f "./manifests/service-account.yaml" -n "$NS"
