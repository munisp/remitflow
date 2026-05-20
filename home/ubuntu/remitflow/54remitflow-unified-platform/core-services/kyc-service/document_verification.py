"""
Open-Source Document Verification Provider

Replaces Smile ID document verification with fully open-source stack:
- PaddleOCR: Text extraction from document images
- Docling: Structured document parsing (PDFs, scanned docs)
- VLM (Vision Language Model): Intelligent field extraction and document classification

Supports Nigerian KYC documents:
- National ID (NIN slip), International Passport, Driver's License, Voter's Card
- Utility bills, Bank statements, Employment letters
- Tax certificates, Business registrations
"""

import os
import io
import re
import json
import hashlib
import logging
import tempfile
from typing import Optional, Dict, Any, List
from datetime import date, datetime
from dataclasses import dataclass, field
from abc import ABC, abstractmethod
from pathlib import Path

import httpx

logger = logging.getLogger(__name__)

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

VLM_ENDPOINT = os.getenv("VLM_ENDPOINT", "http://localhost:11434/api/generate")
VLM_MODEL = os.getenv("VLM_MODEL", "llava:13b")
VLM_TIMEOUT = int(os.getenv("VLM_TIMEOUT", "120"))

PADDLEOCR_SERVICE_URL = os.getenv("PADDLEOCR_SERVICE_URL", "")
DOCLING_SERVICE_URL = os.getenv("DOCLING_SERVICE_URL", "")


DOCUMENT_TYPE_PATTERNS = {
    "national_id": [
        r"national\s+identity", r"national\s+id", r"nin\s+slip",
        r"nigeria.*identification", r"nimc",
    ],
    "passport": [
        r"passport", r"travel\s+document", r"federal\s+republic.*nigeria.*passport",
    ],
    "drivers_license": [
        r"driv(?:er'?s?|ing)\s+licen[cs]e", r"federal\s+road\s+safety",
        r"frsc", r"motor\s+vehicle",
    ],
    "voters_card": [
        r"voter'?s?\s+card", r"permanent\s+voter", r"inec",
        r"independent.*electoral",
    ],
    "utility_bill": [
        r"electricity\s+bill", r"water\s+bill", r"gas\s+bill",
        r"(?:eko|ikeja|abuja)\s+(?:electricity|disco)",
        r"phcn", r"nepa", r"dstv", r"gotv",
    ],
    "bank_statement": [
        r"bank\s+statement", r"account\s+statement", r"statement\s+of\s+account",
        r"transaction\s+history",
    ],
    "employment_letter": [
        r"employment\s+(?:letter|confirmation|certificate)",
        r"letter\s+of\s+employment", r"confirmation\s+of\s+employment",
    ],
    "tax_certificate": [
        r"tax\s+(?:certificate|clearance|receipt)", r"firs",
        r"joint\s+tax\s+board", r"lirs", r"state.*internal\s+revenue",
    ],
    "business_registration": [
        r"certificate\s+of\s+(?:incorporation|registration)",
        r"cac", r"corporate\s+affairs",
    ],
}

FIELD_PATTERNS = {
    "full_name": [
        r"(?:full\s+)?name[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})",
        r"surname[:\s]+(\w+).*(?:first|given|other)\s+name[:\s]+(\w+)",
    ],
    "date_of_birth": [
        r"(?:date\s+of\s+birth|d\.?o\.?b\.?|born)[:\s]+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})",
        r"(?:date\s+of\s+birth|d\.?o\.?b\.?)[:\s]+(\d{1,2}\s+\w+\s+\d{4})",
    ],
    "document_number": [
        r"(?:document|id|card|passport)\s*(?:no|number|#)[:\s]*([A-Z0-9\-]+)",
        r"(?:nin|bvn|tin)[:\s]*(\d{11})",
        r"([A-Z]\d{8})",
    ],
    "expiry_date": [
        r"(?:expiry|expiration|valid\s+(?:until|to)|exp)[:\s]+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})",
        r"(?:date\s+of\s+expiry)[:\s]+(\d{1,2}\s+\w+\s+\d{4})",
    ],
    "issue_date": [
        r"(?:date\s+of\s+issue|issued?)[:\s]+(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})",
        r"(?:issue\s+date)[:\s]+(\d{1,2}\s+\w+\s+\d{4})",
    ],
    "address": [
        r"(?:address|residential\s+address)[:\s]+(.+?)(?:\n|$)",
    ],
    "gender": [
        r"(?:sex|gender)[:\s]+(male|female|m|f)",
    ],
    "nin": [
        r"(?:nin|national\s+identification\s+number)[:\s]*(\d{11})",
    ],
}


@dataclass
class OCRResult:
    text: str
    confidence: float
    blocks: List[Dict[str, Any]] = field(default_factory=list)
    language: str = "en"


@dataclass
class DocumentClassification:
    document_type: str
    confidence: float
    detected_country: str = "NG"


@dataclass
class ExtractedFields:
    full_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    middle_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    document_number: Optional[str] = None
    expiry_date: Optional[str] = None
    issue_date: Optional[str] = None
    address: Optional[str] = None
    gender: Optional[str] = None
    nin: Optional[str] = None
    raw_fields: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        result = {}
        for k, v in self.__dict__.items():
            if v is not None and k != "raw_fields":
                result[k] = v
        result.update(self.raw_fields)
        return result


@dataclass
class VerificationResult:
    is_valid: bool
    document_type: str
    extracted_data: Dict[str, Any]
    confidence_score: float
    issues: List[str]
    provider: str
    provider_reference: Optional[str] = None
    raw_response: Optional[Dict[str, Any]] = None


class OCREngine(ABC):
    @abstractmethod
    async def extract_text(self, image_data: bytes, language: str = "en") -> OCRResult:
        pass


class PaddleOCREngine(OCREngine):
    async def extract_text(self, image_data: bytes, language: str = "en") -> OCRResult:
        if PADDLEOCR_SERVICE_URL:
            return await self._call_service(image_data, language)
        return await self._call_local(image_data, language)

    async def _call_service(self, image_data: bytes, language: str) -> OCRResult:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{PADDLEOCR_SERVICE_URL}/ocr",
                files={"file": ("document.png", image_data, "image/png")},
                data={"language": language},
                timeout=60.0,
            )
            response.raise_for_status()
            data = response.json()

            text_lines = []
            blocks = []
            total_conf = 0.0
            count = 0

            for item in data.get("results", []):
                text = item.get("text", "")
                conf = item.get("confidence", 0.0)
                bbox = item.get("bbox", [])
                text_lines.append(text)
                blocks.append({"text": text, "confidence": conf, "bbox": bbox})
                total_conf += conf
                count += 1

            avg_conf = total_conf / count if count > 0 else 0.0
            return OCRResult(
                text="\n".join(text_lines),
                confidence=avg_conf,
                blocks=blocks,
            )

    async def _call_local(self, image_data: bytes, language: str) -> OCRResult:
        try:
            from paddleocr import PaddleOCR

            lang_map = {"en": "en", "ha": "en", "yo": "en", "ig": "en"}
            ocr_lang = lang_map.get(language, "en")

            ocr = PaddleOCR(use_angle_cls=True, lang=ocr_lang, show_log=False)

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp.write(image_data)
                tmp_path = tmp.name

            try:
                result = ocr.ocr(tmp_path, cls=True)
            finally:
                os.unlink(tmp_path)

            text_lines = []
            blocks = []
            total_conf = 0.0
            count = 0

            if result and result[0]:
                for line in result[0]:
                    bbox = line[0]
                    text = line[1][0]
                    conf = line[1][1]
                    text_lines.append(text)
                    blocks.append({"text": text, "confidence": conf, "bbox": bbox})
                    total_conf += conf
                    count += 1

            avg_conf = total_conf / count if count > 0 else 0.0
            return OCRResult(
                text="\n".join(text_lines),
                confidence=avg_conf,
                blocks=blocks,
            )

        except ImportError:
            logger.warning("PaddleOCR not installed locally, returning empty result")
            return OCRResult(text="", confidence=0.0, blocks=[])


class DoclingParser:
    async def parse_document(self, document_data: bytes, filename: str = "document.pdf") -> OCRResult:
        if DOCLING_SERVICE_URL:
            return await self._call_service(document_data, filename)
        return await self._call_local(document_data, filename)

    async def _call_service(self, document_data: bytes, filename: str) -> OCRResult:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{DOCLING_SERVICE_URL}/convert",
                files={"file": (filename, document_data, "application/pdf")},
                timeout=120.0,
            )
            response.raise_for_status()
            data = response.json()

            text = data.get("text", "")
            tables = data.get("tables", [])
            metadata = data.get("metadata", {})

            return OCRResult(
                text=text,
                confidence=0.9,
                blocks=[{"tables": tables, "metadata": metadata}],
            )

    async def _call_local(self, document_data: bytes, filename: str) -> OCRResult:
        try:
            from docling.document_converter import DocumentConverter

            with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
                tmp.write(document_data)
                tmp_path = tmp.name

            try:
                converter = DocumentConverter()
                result = converter.convert(tmp_path)
                text = result.document.export_to_text()
            finally:
                os.unlink(tmp_path)

            return OCRResult(text=text, confidence=0.85, blocks=[])

        except ImportError:
            logger.warning("Docling not installed locally, returning empty result")
            return OCRResult(text="", confidence=0.0, blocks=[])


class VLMAnalyzer:
    async def analyze_document(
        self,
        image_data: bytes,
        ocr_text: str,
        document_type_hint: Optional[str] = None,
    ) -> Dict[str, Any]:
        import base64

        image_b64 = base64.b64encode(image_data).decode("utf-8")

        prompt = self._build_prompt(ocr_text, document_type_hint)

        try:
            async with httpx.AsyncClient() as client:
                payload = {
                    "model": VLM_MODEL,
                    "prompt": prompt,
                    "images": [image_b64],
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 2048},
                }

                response = await client.post(
                    VLM_ENDPOINT,
                    json=payload,
                    timeout=VLM_TIMEOUT,
                )
                response.raise_for_status()
                data = response.json()

                response_text = data.get("response", "")
                return self._parse_vlm_response(response_text)

        except Exception as e:
            logger.warning(f"VLM analysis failed (will use regex fallback): {e}")
            return {}

    def _build_prompt(self, ocr_text: str, document_type_hint: Optional[str]) -> str:
        type_context = f"This appears to be a {document_type_hint}." if document_type_hint else ""

        return f"""Analyze this identity document image and extract structured information.
{type_context}

OCR text extracted from the document:
---
{ocr_text[:2000]}
---

Extract the following fields as JSON (use null for missing fields):
{{
  "document_type": "national_id|passport|drivers_license|voters_card|utility_bill|bank_statement|employment_letter|tax_certificate|business_registration",
  "full_name": "...",
  "first_name": "...",
  "last_name": "...",
  "middle_name": "...",
  "date_of_birth": "YYYY-MM-DD",
  "document_number": "...",
  "expiry_date": "YYYY-MM-DD",
  "issue_date": "YYYY-MM-DD",
  "address": "...",
  "gender": "male|female",
  "nin": "11-digit NIN if present",
  "issuing_authority": "...",
  "is_valid_document": true/false,
  "quality_issues": ["list of issues like blurry, partial, expired"]
}}

Return ONLY valid JSON, no explanation."""

    def _parse_vlm_response(self, response_text: str) -> Dict[str, Any]:
        json_match = re.search(r"\{[\s\S]*\}", response_text)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        return {}


def classify_document(text: str) -> DocumentClassification:
    text_lower = text.lower()
    best_type = "unknown"
    best_score = 0.0

    for doc_type, patterns in DOCUMENT_TYPE_PATTERNS.items():
        matches = 0
        for pattern in patterns:
            if re.search(pattern, text_lower):
                matches += 1
        if matches > 0:
            score = matches / len(patterns)
            if score > best_score:
                best_score = score
                best_type = doc_type

    country = "NG"
    if re.search(r"nigeria|naira|ngn|lagos|abuja|ibadan", text_lower):
        country = "NG"
    elif re.search(r"ghana|cedis|ghs|accra", text_lower):
        country = "GH"
    elif re.search(r"kenya|shilling|kes|nairobi", text_lower):
        country = "KE"

    return DocumentClassification(
        document_type=best_type,
        confidence=min(best_score + 0.3, 1.0) if best_score > 0 else 0.0,
        detected_country=country,
    )


def extract_fields_regex(text: str) -> ExtractedFields:
    fields = ExtractedFields()

    for field_name, patterns in FIELD_PATTERNS.items():
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE | re.MULTILINE)
            if match:
                value = match.group(1).strip() if match.lastindex else match.group(0).strip()
                if field_name == "full_name" and match.lastindex and match.lastindex >= 2:
                    fields.raw_fields["surname"] = match.group(1)
                    fields.raw_fields["other_names"] = match.group(2)
                    value = f"{match.group(2)} {match.group(1)}"

                if hasattr(fields, field_name):
                    object.__setattr__(fields, field_name, value)
                else:
                    fields.raw_fields[field_name] = value
                break

    if fields.full_name and not fields.first_name:
        parts = fields.full_name.split()
        if len(parts) >= 2:
            fields.first_name = parts[0]
            fields.last_name = parts[-1]
            if len(parts) > 2:
                fields.middle_name = " ".join(parts[1:-1])

    return fields


def validate_document(
    document_type: str,
    extracted: ExtractedFields,
    expected_name: Optional[str] = None,
    expected_dob: Optional[str] = None,
) -> List[str]:
    issues = []

    if not extracted.full_name and not extracted.first_name:
        issues.append("Could not extract name from document")

    if document_type in ("national_id", "passport", "drivers_license", "voters_card"):
        if not extracted.document_number:
            issues.append("Could not extract document number")

    if document_type == "passport":
        if not extracted.expiry_date:
            issues.append("Could not extract passport expiry date")
        elif extracted.expiry_date:
            try:
                parts = re.split(r"[/\-\.]", extracted.expiry_date)
                if len(parts) == 3:
                    year = int(parts[2]) if len(parts[2]) == 4 else int(parts[2]) + 2000
                    exp_date = date(year, int(parts[1]), int(parts[0]))
                    if exp_date < date.today():
                        issues.append("Document has expired")
            except (ValueError, IndexError):
                pass

    if expected_name and extracted.full_name:
        name_a = expected_name.lower().strip()
        name_b = extracted.full_name.lower().strip()
        if name_a != name_b:
            words_a = set(name_a.split())
            words_b = set(name_b.split())
            overlap = words_a & words_b
            if len(overlap) < min(len(words_a), len(words_b)) * 0.5:
                issues.append(f"Name mismatch: expected '{expected_name}', found '{extracted.full_name}'")

    return issues


async def download_document(url: str) -> bytes:
    async with httpx.AsyncClient() as client:
        response = await client.get(url, timeout=30.0, follow_redirects=True)
        response.raise_for_status()
        return response.content


class OpenSourceDocumentProvider:
    def __init__(self):
        self.ocr_engine = PaddleOCREngine()
        self.docling_parser = DoclingParser()
        self.vlm_analyzer = VLMAnalyzer()

    async def verify_document(
        self,
        document_url: str,
        document_type: str,
        country: str = "NG",
        expected_name: Optional[str] = None,
        expected_dob: Optional[str] = None,
    ) -> VerificationResult:
        ref_id = hashlib.sha256(
            f"{document_url}:{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:16]

        try:
            doc_data = await download_document(document_url)
        except Exception as e:
            logger.error(f"Failed to download document: {e}")
            return VerificationResult(
                is_valid=False,
                document_type=document_type,
                extracted_data={},
                confidence_score=0.0,
                issues=[f"Failed to download document: {str(e)}"],
                provider="opensource_ocr",
                provider_reference=ref_id,
            )

        is_pdf = doc_data[:4] == b"%PDF"

        if is_pdf:
            ocr_result = await self.docling_parser.parse_document(doc_data)
        else:
            ocr_result = await self.ocr_engine.extract_text(doc_data)

        if not ocr_result.text.strip():
            return VerificationResult(
                is_valid=False,
                document_type=document_type,
                extracted_data={},
                confidence_score=0.0,
                issues=["No text could be extracted from document"],
                provider="opensource_ocr",
                provider_reference=ref_id,
            )

        classification = classify_document(ocr_result.text)

        regex_fields = extract_fields_regex(ocr_result.text)

        vlm_fields = {}
        if not is_pdf:
            vlm_fields = await self.vlm_analyzer.analyze_document(
                doc_data, ocr_result.text, document_type
            )

        merged = self._merge_fields(regex_fields, vlm_fields)

        issues = validate_document(document_type, merged, expected_name, expected_dob)

        if document_type != "unknown" and classification.document_type != "unknown":
            if classification.document_type != document_type:
                issues.append(
                    f"Document appears to be '{classification.document_type}' "
                    f"but was submitted as '{document_type}'"
                )

        if vlm_fields.get("quality_issues"):
            issues.extend(vlm_fields["quality_issues"])

        confidence = self._calculate_confidence(
            ocr_result.confidence, classification.confidence, merged, issues
        )

        is_valid = confidence >= 0.5 and len([i for i in issues if "expired" in i.lower() or "mismatch" in i.lower()]) == 0

        extracted_data = merged.to_dict()
        extracted_data["ocr_confidence"] = ocr_result.confidence
        extracted_data["classification_confidence"] = classification.confidence
        extracted_data["detected_document_type"] = classification.document_type
        extracted_data["detected_country"] = classification.detected_country

        return VerificationResult(
            is_valid=is_valid,
            document_type=classification.document_type if classification.document_type != "unknown" else document_type,
            extracted_data=extracted_data,
            confidence_score=confidence,
            issues=issues,
            provider="opensource_ocr",
            provider_reference=ref_id,
            raw_response={
                "ocr_text_length": len(ocr_result.text),
                "ocr_blocks": len(ocr_result.blocks),
                "vlm_used": bool(vlm_fields),
                "regex_fields_found": len([v for v in regex_fields.to_dict().values() if v]),
            },
        )

    def _merge_fields(self, regex: ExtractedFields, vlm: Dict[str, Any]) -> ExtractedFields:
        merged = ExtractedFields(
            full_name=regex.full_name,
            first_name=regex.first_name,
            last_name=regex.last_name,
            middle_name=regex.middle_name,
            date_of_birth=regex.date_of_birth,
            document_number=regex.document_number,
            expiry_date=regex.expiry_date,
            issue_date=regex.issue_date,
            address=regex.address,
            gender=regex.gender,
            nin=regex.nin,
            raw_fields=dict(regex.raw_fields),
        )

        for field_name in [
            "full_name", "first_name", "last_name", "middle_name",
            "date_of_birth", "document_number", "expiry_date",
            "issue_date", "address", "gender", "nin",
        ]:
            vlm_val = vlm.get(field_name)
            current = getattr(merged, field_name)
            if vlm_val and not current:
                object.__setattr__(merged, field_name, str(vlm_val))

        for k, v in vlm.items():
            if v and k not in merged.to_dict() and k not in (
                "is_valid_document", "quality_issues", "document_type"
            ):
                merged.raw_fields[k] = v

        return merged

    def _calculate_confidence(
        self,
        ocr_conf: float,
        class_conf: float,
        fields: ExtractedFields,
        issues: List[str],
    ) -> float:
        field_count = len([v for v in fields.to_dict().values() if v])
        field_score = min(field_count / 5, 1.0)

        base = (ocr_conf * 0.3) + (class_conf * 0.3) + (field_score * 0.4)

        penalty = len(issues) * 0.1
        return max(min(base - penalty, 1.0), 0.0)


def get_opensource_document_provider() -> OpenSourceDocumentProvider:
    return OpenSourceDocumentProvider()
