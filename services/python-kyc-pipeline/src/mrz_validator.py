"""
RemitFlow KYC — Clean-room ICAO 9303 MRZ validator.

Implements the check-digit algorithm of ICAO Doc 9303 Part 3, §4.3
("7-3-1" weighting, modulo 10) for TD1, TD2 and TD3 machine readable
zones, including per-field check digits and the composite (overall)
check digit.

CLEAN-ROOM NOTICE: this module was written directly from the public
ICAO 9303 specification. It deliberately does NOT import or derive from
the GPLv3 `mrz` PyPI package or the AGPL `mrz-scanner` project, both of
which are licence-incompatible with this repository.

Check-digit algorithm (ICAO 9303-3 §4.3):
  - Character values: '0'-'9' → 0-9, 'A'-'Z' → 10-35, '<' (filler) → 0.
  - Weights repeat cyclically 7, 3, 1 across the field, left to right.
  - Check digit = (sum of value*weight) mod 10.

Formats:
  - TD3 (passport):  2 lines x 44 chars.
  - TD2 (ID/visa):   2 lines x 36 chars.
  - TD1 (ID card):   3 lines x 30 chars.

This validator is a HARD GATE: any per-field or composite checksum
failure must cause the document to be REJECTED downstream. It is,
however, only an integrity check — a passing checksum proves the MRZ is
self-consistent, NOT that the document is genuine.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── Character value table (ICAO 9303-3 §4.3) ─────────────────────────────────
def _char_value(c: str) -> int:
    if "0" <= c <= "9":
        return ord(c) - ord("0")
    if "A" <= c <= "Z":
        return ord(c) - ord("A") + 10
    if c == "<":
        return 0
    raise ValueError(f"invalid MRZ character: {c!r}")


_WEIGHTS = (7, 3, 1)


def compute_check_digit(field_str: str) -> str:
    """Compute the ICAO 9303 7-3-1 mod-10 check digit for a field."""
    total = 0
    for i, c in enumerate(field_str):
        total += _char_value(c) * _WEIGHTS[i % 3]
    return str(total % 10)


def verify_check_digit(field_str: str, check_char: str) -> bool:
    """Return True iff check_char matches the computed check digit."""
    if not check_char or not check_char.isdigit():
        return False
    try:
        return compute_check_digit(field_str) == check_char
    except ValueError:
        return False


# ── Result model ──────────────────────────────────────────────────────────────
@dataclass
class FieldCheck:
    """Result of one per-field check-digit verification."""
    name: str
    value: str
    check_char: str
    valid: bool


@dataclass
class MRZValidation:
    """Full MRZ validation result. `composite_valid` is the hard gate."""
    format:            str = "unknown"          # 'TD1' | 'TD2' | 'TD3' | 'unknown'
    parsed:            bool = False
    field_checks:      list[FieldCheck] = field(default_factory=list)
    composite_valid:   bool = False             # overall check digit / aggregate
    all_valid:         bool = False             # every per-field check AND composite
    # Parsed fields (populated regardless of checksum outcome, for cross-validation)
    doc_type:          str = ""
    issuing_country:   str = ""
    surname:           str = ""
    given_names:       str = ""
    doc_number:        str = ""
    nationality:       str = ""
    date_of_birth:     str = ""                 # YYMMDD
    sex:               str = ""
    expiry_date:       str = ""                 # YYMMDD
    personal_number:   str = ""
    errors:            list[str] = field(default_factory=list)


_MRZ_LINE_RE = re.compile(r"^[A-Z0-9<]+$")


def _clean_lines(mrz_text: str) -> list[str]:
    lines = []
    for raw in mrz_text.strip().splitlines():
        line = re.sub(r"\s+", "", raw).upper()
        if line:
            lines.append(line)
    return lines


def _parse_name(name_field: str) -> tuple[str, str]:
    """Split 'SURNAME<<GIVEN<NAMES' into (surname, given_names)."""
    name_field = name_field.strip("<")
    if "<<" in name_field:
        surname, _, given = name_field.partition("<<")
        return surname.replace("<", " ").strip(), given.replace("<", " ").strip()
    return name_field.replace("<", " ").strip(), ""


def validate_mrz(mrz_text: str) -> MRZValidation:
    """
    Validate an MRZ block per ICAO 9303. Detects TD1/TD2/TD3 by line
    geometry. Returns an MRZValidation; callers MUST treat
    `all_valid == False` as a document rejection when an MRZ was found.
    """
    result = MRZValidation()
    lines = _clean_lines(mrz_text)

    if not lines:
        result.errors.append("empty_mrz")
        return result

    for line in lines:
        if not _MRZ_LINE_RE.match(line):
            result.errors.append(f"invalid_characters_in_line:{line[:8]}...")
            return result

    lengths = {len(l) for l in lines}
    if len(lines) == 2 and lengths == {44}:
        return _validate_td3(lines, result)
    if len(lines) == 2 and lengths == {36}:
        return _validate_td2(lines, result)
    if len(lines) == 3 and lengths == {30}:
        return _validate_td1(lines, result)

    result.errors.append(f"unrecognized_geometry:{[len(l) for l in lines]}")
    return result


# ── TD3 (passport): 2 x 44 ────────────────────────────────────────────────────
def _validate_td3(lines: list[str], r: MRZValidation) -> MRZValidation:
    r.format = "TD3"
    l1, l2 = lines
    r.parsed = True

    r.doc_type         = l1[0:2].strip("<")
    r.issuing_country  = l1[2:5]
    r.surname, r.given_names = _parse_name(l1[5:44])

    doc_number_field   = l2[0:9]
    doc_number_check   = l2[9]
    dob_field          = l2[13:19]
    dob_check          = l2[19]
    expiry_field       = l2[21:27]
    expiry_check       = l2[27]
    personal_field     = l2[28:42]
    personal_check     = l2[42]
    composite_check    = l2[43]

    r.doc_number       = doc_number_field.rstrip("<")
    r.nationality      = l2[10:13]
    r.date_of_birth    = dob_field
    r.sex              = l2[20]
    r.expiry_date      = expiry_field
    r.personal_number  = personal_field.rstrip("<")

    r.field_checks = [
        FieldCheck("doc_number",      doc_number_field, doc_number_check,
                   verify_check_digit(doc_number_field, doc_number_check)),
        FieldCheck("date_of_birth",   dob_field, dob_check,
                   verify_check_digit(dob_field, dob_check)),
        FieldCheck("expiry_date",     expiry_field, expiry_check,
                   verify_check_digit(expiry_field, expiry_check)),
        FieldCheck("personal_number", personal_field, personal_check,
                   verify_check_digit(personal_field, personal_check)),
    ]

    # Composite check digit (ICAO 9303-3 §4.3.1 TD3):
    # doc number+check, DOB+check, expiry+check, personal number+check.
    composite_input = (
        l2[0:10] + l2[13:20] + l2[21:28] + l2[28:43]
    )
    r.composite_valid = verify_check_digit(composite_input, composite_check)
    r.field_checks.append(
        FieldCheck("composite", composite_input, composite_check, r.composite_valid)
    )

    r.all_valid = all(fc.valid for fc in r.field_checks)
    if not r.all_valid:
        r.errors = [f"checksum_failed:{fc.name}" for fc in r.field_checks if not fc.valid]
    return r


# ── TD2 (ID / visa type B): 2 x 36 ───────────────────────────────────────────
def _validate_td2(lines: list[str], r: MRZValidation) -> MRZValidation:
    r.format = "TD2"
    l1, l2 = lines
    r.parsed = True

    r.doc_type        = l1[0:2].strip("<")
    r.issuing_country = l1[2:5]
    r.surname, r.given_names = _parse_name(l1[5:36])

    doc_number_field  = l2[0:9]
    doc_number_check  = l2[9]
    dob_field         = l2[13:19]
    dob_check         = l2[19]
    expiry_field      = l2[21:27]
    expiry_check      = l2[27]
    optional_field    = l2[28:35]   # personal number / optional data
    composite_check   = l2[35]

    r.doc_number      = doc_number_field.rstrip("<")
    r.nationality     = l2[10:13]
    r.date_of_birth   = dob_field
    r.sex             = l2[20]
    r.expiry_date     = expiry_field
    r.personal_number = optional_field.rstrip("<")

    r.field_checks = [
        FieldCheck("doc_number",    doc_number_field, doc_number_check,
                   verify_check_digit(doc_number_field, doc_number_check)),
        FieldCheck("date_of_birth", dob_field, dob_check,
                   verify_check_digit(dob_field, dob_check)),
        FieldCheck("expiry_date",   expiry_field, expiry_check,
                   verify_check_digit(expiry_field, expiry_check)),
    ]

    # TD2 composite (ICAO 9303-3 §4.3.2): doc number+check, DOB+check,
    # expiry+check, optional data — the trailing filler of optional data is
    # included, but NOT a separate optional-data check digit.
    composite_input = l2[0:10] + l2[13:20] + l2[21:35]
    r.composite_valid = verify_check_digit(composite_input, composite_check)
    r.field_checks.append(
        FieldCheck("composite", composite_input, composite_check, r.composite_valid)
    )

    r.all_valid = all(fc.valid for fc in r.field_checks)
    if not r.all_valid:
        r.errors = [f"checksum_failed:{fc.name}" for fc in r.field_checks if not fc.valid]
    return r


# ── TD1 (ID card): 3 x 30 ─────────────────────────────────────────────────────
def _validate_td1(lines: list[str], r: MRZValidation) -> MRZValidation:
    r.format = "TD1"
    l1, l2, l3 = lines
    r.parsed = True

    r.doc_type        = l1[0:2].strip("<")
    r.issuing_country = l1[2:5]

    doc_number_field  = l1[5:14]
    doc_number_check  = l1[14]
    optional1         = l1[15:30]

    dob_field         = l2[0:6]
    dob_check         = l2[6]
    expiry_field      = l2[8:14]
    expiry_check      = l2[14]
    optional2         = l2[18:29]
    composite_check   = l2[29]

    r.doc_number      = doc_number_field.rstrip("<")
    r.date_of_birth   = dob_field
    r.sex             = l2[7]
    r.expiry_date     = expiry_field
    r.nationality     = l2[15:18]
    r.personal_number = (optional1 + optional2).rstrip("<")
    r.surname, r.given_names = _parse_name(l3)

    r.field_checks = [
        FieldCheck("doc_number",    doc_number_field, doc_number_check,
                   verify_check_digit(doc_number_field, doc_number_check)),
        FieldCheck("date_of_birth", dob_field, dob_check,
                   verify_check_digit(dob_field, dob_check)),
        FieldCheck("expiry_date",   expiry_field, expiry_check,
                   verify_check_digit(expiry_field, expiry_check)),
    ]

    # TD1 composite (ICAO 9303-3 §4.3.3): upper line chars 6-30,
    # middle line chars 1-10 and 14-20 and 22-29 (0-indexed: l1[5:30],
    # l2[0:10], l2[13:19]... ) — spec exact ordering:
    #   l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29]
    composite_input = l1[5:30] + l2[0:7] + l2[8:15] + l2[18:29]
    r.composite_valid = verify_check_digit(composite_input, composite_check)
    r.field_checks.append(
        FieldCheck("composite", composite_input, composite_check, r.composite_valid)
    )

    r.all_valid = all(fc.valid for fc in r.field_checks)
    if not r.all_valid:
        r.errors = [f"checksum_failed:{fc.name}" for fc in r.field_checks if not fc.valid]
    return r
