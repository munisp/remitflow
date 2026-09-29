#!/usr/bin/env python3
"""Download the German BSI CSCA Master List and store it locally.

Source (verified 2026-06): the BSI publishes the current list from
  https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/ElekAusweise/CSCA/GermanMasterList.html
as a ZIP at
  https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/ElekAusweise/CSCA/GermanMasterList.zip
The `?__blob=publicationFile&v=<N>` suffix changes with each release; the
bare path redirects/resolves to the current version.

The ZIP contains the ICAO Doc 9303-12 CscaMasterList (`.ml`, CMS-signed) and
typically an LDIF dump. Both formats are accepted by masterlist.py.

License / terms: the BSI permits commercial use of its master list provided
it is not used for advertising and no appearance of BSI cooperation is
created. The ICAO PKD public master list is deliberately NOT used — its
download terms are non-commercial. Do not point this script at
pkddownloadsg.icao.int.

Usage:
  CSCA_MASTERLIST_URL=<override> python scripts/fetch_masterlist.py [--out /app/data/masterlist.ml]
"""

from __future__ import annotations

import argparse
import io
import logging
import os
import sys
import zipfile

import httpx

log = logging.getLogger("fetch_masterlist")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

DEFAULT_URL = (
    "https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/ElekAusweise/CSCA/"
    "GermanMasterList.zip?__blob=publicationFile"
)
# Landing page (source of truth for the current zip link):
# https://www.bsi.bund.de/SharedDocs/Downloads/DE/BSI/ElekAusweise/CSCA/GermanMasterList.html
DEFAULT_OUT = os.environ.get("CSCA_MASTERLIST_PATH", "/app/data/masterlist.ml")


def _resolve_zip_url(client: httpx.Client, url: str, payload: bytes) -> bytes:
    """If the URL served the HTML landing page instead of the zip, extract the
    current GermanMasterList.zip link from it and download that."""
    if payload[:15].lower().lstrip().startswith(b"<!doctype html") or b"<html" in payload[:512].lower():
        import re

        text = payload.decode("utf-8", errors="replace")
        m = re.search(r'href="([^"]*GermanMasterList\.zip[^"]*)"', text)
        if not m:
            raise RuntimeError("landing page did not contain a GermanMasterList.zip link")
        href = m.group(1).replace("&amp;", "&")
        if href.startswith("/"):
            href = "https://www.bsi.bund.de" + href
        log.info("resolved zip link from landing page: %s", href)
        resp = client.get(href)
        resp.raise_for_status()
        return resp.content
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch the BSI CSCA master list")
    parser.add_argument("--out", default=DEFAULT_OUT, help="output path (.ml or .ldif)")
    args = parser.parse_args()

    url = os.environ.get("CSCA_MASTERLIST_URL", DEFAULT_URL)
    if "icao.int" in url or "pkd" in url.lower() and "bsi" not in url.lower():
        log.error("refusing ICAO PKD URL — non-commercial terms; use the BSI master list")
        return 2

    log.info("downloading master list from %s", url)
    with httpx.Client(follow_redirects=True, timeout=60.0) as client:
        resp = client.get(url)
        resp.raise_for_status()
    payload = _resolve_zip_url(client, url, resp.content)
    log.info("downloaded %d bytes", len(payload))

    if zipfile.is_zipfile(io.BytesIO(payload)):
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            names = zf.namelist()
            log.info("zip entries: %s", names)
            # Prefer the .ml (canonical, CMS-signed); fall back to LDIF.
            chosen = next((n for n in names if n.lower().endswith(".ml")), None) or next(
                (n for n in names if n.lower().endswith(".ldif")), None
            )
            if chosen is None:
                log.error("zip contains no .ml or .ldif entry: %s", names)
                return 1
            payload = zf.read(chosen)
            log.info("extracted %s (%d bytes)", chosen, len(payload))

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    tmp = args.out + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(payload)
    os.replace(tmp, args.out)  # atomic: never leave a half-written trust store
    log.info("master list written to %s", args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
