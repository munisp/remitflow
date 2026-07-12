"""
Lightweight VPN/Tor/datacenter IP heuristic detector.

No external IP-intelligence API — this is a simplified, best-effort check
using reverse DNS + known provider name/CIDR patterns. For production-grade
accuracy, replace with a real IP intelligence service (e.g. IPQualityScore,
MaxMind GeoIP2 Anonymous IP DB). Never raises — always returns a result dict,
defaulting to "not flagged" on any lookup failure so a DNS hiccup never
blocks a legitimate login.
"""

import ipaddress
import socket
from typing import Dict

from utils.helpers import create_logger

logger = create_logger(__name__)

_VPN_HOSTNAME_PATTERNS = (
    "vpn", "nordvpn", "expressvpn", "surfshark", "protonvpn", "mullvad",
    "privateinternetaccess", "pia-", "cyberghost", "ipvanish", "torguard",
    "windscribe", "hidemyass", "tunnelbear",
)

_TOR_HOSTNAME_PATTERNS = ("tor-exit", "torexitnode", ".exit.", "tor-relay")

_DATACENTER_HOSTNAME_PATTERNS = (
    "amazonaws.com", "googleusercontent.com", "azure", "digitalocean",
    "linode.com", "ovh.net", "hetzner", "vultr.com",
)

# Small representative sample of well-known datacenter CIDR ranges. Not
# exhaustive — a real deployment should pull a maintained IP-range feed.
_DATACENTER_CIDRS = [
    ipaddress.ip_network("3.0.0.0/9"),        # AWS (partial)
    ipaddress.ip_network("34.64.0.0/10"),     # GCP (partial)
    ipaddress.ip_network("20.0.0.0/8"),       # Azure (partial)
    ipaddress.ip_network("104.131.0.0/16"),   # DigitalOcean (partial)
    ipaddress.ip_network("172.104.0.0/15"),   # Linode (partial)
]


def _is_private_or_local(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private or addr.is_loopback or addr.is_link_local
    except ValueError:
        return True  # not a parseable IP ("unknown", etc.) — nothing to check


def _matches_any(hostname: str, patterns: tuple) -> bool:
    lowered = hostname.lower()
    return any(p in lowered for p in patterns)


def _in_datacenter_range(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _DATACENTER_CIDRS)


def detect_vpn(ip: str) -> Dict[str, bool]:
    """Best-effort VPN/Tor/datacenter classification for a client IP."""
    result = {"is_vpn": False, "is_tor": False, "is_datacenter": False, "ip": ip}

    if not ip or ip == "unknown" or _is_private_or_local(ip):
        return result

    if _in_datacenter_range(ip):
        result["is_datacenter"] = True

    try:
        hostname, _, _ = socket.gethostbyaddr(ip)
    except (socket.herror, socket.gaierror, OSError):
        hostname = ""

    if hostname:
        if _matches_any(hostname, _VPN_HOSTNAME_PATTERNS):
            result["is_vpn"] = True
        if _matches_any(hostname, _TOR_HOSTNAME_PATTERNS):
            result["is_tor"] = True
        if _matches_any(hostname, _DATACENTER_HOSTNAME_PATTERNS):
            result["is_datacenter"] = True

    return result
