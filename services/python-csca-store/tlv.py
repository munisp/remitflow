"""Minimal ISO 7816 / ASN.1-BER TLV walking helpers for eMRTD data groups.

Clean-room implementation — only what this service needs:
find a tag inside a (possibly nested) TLV structure and read its value.
"""


def _read_tag(buf: bytes, off: int) -> tuple[bytes, int]:
    start = off
    if off >= len(buf):
        raise ValueError("tlv: offset beyond buffer")
    b = buf[off]
    off += 1
    if b & 0x1F == 0x1F:  # multi-byte tag
        while True:
            if off >= len(buf):
                raise ValueError("tlv: truncated multi-byte tag")
            cont = buf[off] & 0x80
            off += 1
            if not cont:
                break
    return buf[start:off], off


def _read_length(buf: bytes, off: int) -> tuple[int, int]:
    if off >= len(buf):
        raise ValueError("tlv: truncated length")
    b = buf[off]
    off += 1
    if b < 0x80:
        return b, off
    n = b & 0x7F
    if n == 0:
        raise ValueError("tlv: indefinite length not supported")
    if off + n > len(buf):
        raise ValueError("tlv: truncated long-form length")
    return int.from_bytes(buf[off : off + n], "big"), off + n


def read_tlv(buf: bytes, off: int = 0) -> tuple[bytes, bytes, int, bool]:
    """Read one TLV at off. Returns (tag, value, next_offset, constructed)."""
    tag, off = _read_tag(buf, off)
    length, off = _read_length(buf, off)
    if off + length > len(buf):
        raise ValueError("tlv: value extends beyond buffer")
    return tag, buf[off : off + length], off + length, bool(tag[0] & 0x20)


def find_tag(buf: bytes, wanted: bytes, _depth: int = 0) -> bytes | None:
    """Depth-first search for a tag; returns its value or None."""
    if _depth > 8:
        return None
    off = 0
    while off < len(buf):
        try:
            tag, value, off, constructed = read_tlv(buf, off)
        except ValueError:
            return None
        if tag == wanted:
            return value
        if constructed:
            found = find_tag(value, wanted, _depth + 1)
            if found is not None:
                return found
    return None
