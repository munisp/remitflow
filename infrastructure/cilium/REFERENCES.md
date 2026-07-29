# Cilium Source Notes

The RemitFlow Cilium implementation is pinned to the official **Cilium 1.19.6** Helm chart and uses only configuration keys verified against that chart’s upstream values file.

| Topic | Implementation decision | Official source |
|---|---|---|
| Helm installation | Use the OCI chart `oci://quay.io/cilium/charts/cilium`, version `1.19.6`, and select routing/IPAM per target environment. | [Installation using Helm](https://docs.cilium.io/en/stable/installation/k8s-install-helm/) |
| Kernel and CNI prerequisites | Kubernetes needs CNI networking and the generic installation guidance requires Linux kernel 5.10 or newer. | [Installation using Helm](https://docs.cilium.io/en/stable/installation/k8s-install-helm/) |
| WireGuard encryption | Enable `encryption.enabled=true`, `encryption.type=wireguard`, and `encryption.nodeEncryption=true`; permit node-to-node UDP/51871. | [WireGuard Transparent Encryption](https://docs.cilium.io/en/stable/security/network/encryption-wireguard/) |
| Hubble | Enable Relay for cluster-level flow visibility and keep UI internal; Hubble supports policy-correlated flow context. | [Network Observability with Hubble](https://docs.cilium.io/en/stable/observability/hubble/) |
| Sensitive flow data | Enable Hubble redaction and allow only tracing headers in the configured HTTP header allow list. | [Cilium 1.19.6 Helm values](https://raw.githubusercontent.com/cilium/cilium/v1.19.6/install/kubernetes/cilium/values.yaml) |
| Namespace and DNS policies | Namespaced CiliumNetworkPolicies can select cross-namespace resolver endpoints with `k8s:io.kubernetes.pod.namespace`; DNS policies should include resolver access plus explicit DNS rules. | [Using Kubernetes Constructs In Policy](https://docs.cilium.io/en/stable/security/policy/kubernetes/) and [Locking Down External Access with DNS-Based Policies](https://docs.cilium.io/en/stable/security/dns/) |
| Audit rollout | Policy Audit Mode logs would-be drops but does not enforce policy, so it is a temporary discovery step rather than production enforcement. | [Creating Policies from Verdicts](https://docs.cilium.io/en/stable/security/policy-creation/) |
| Kube-proxy migration | An in-place kube-proxy replacement change breaks existing service connections; therefore the base overlay leaves it disabled and provides a new-cluster-only example. | [Kubernetes Without kube-proxy](https://docs.cilium.io/en/stable/network/kubernetes/kubeproxy-free/) |

The base configuration intentionally does **not** enable cluster mesh, Cilium ingress/Gateway API, provider-specific IPAM, BGP, or egress gateway. The platform already uses APISIX plus OpenAppSec for ingress, and the remaining features require environment-specific network and trust-boundary decisions.
