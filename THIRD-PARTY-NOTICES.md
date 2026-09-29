# Third-Party Notices — Wave 15 (Open-Source-First KYC)

This file discloses licenses and provenance notes for components added or
re-purposed in wave 15. Policy: only permissive OSI licenses (MIT /
Apache-2.0 / BSD) for new dependencies; LGPL flagged for counsel;
non-commercial assets are PROHIBITED.

## New dependencies (wave 15)

| Component | Where | License | Notes |
|---|---|---|---|
| rapidocr-onnxruntime | services/python-kyc-pipeline | Apache-2.0 | PP-OCRv5 ONNX runtime for VIZ OCR |
| onnxruntime | services/python-kyc-pipeline, services/python-kyc-liveness | MIT | |
| mediapipe (python) | services/python-kyc-liveness | Apache-2.0 | server-side challenge frame re-verification |
| @mediapipe/tasks-vision | uis/pwa | Apache-2.0 | WASM Face Landmarker, blendshapes + head pose |
| react-native-vision-camera | uis/react-native | MIT | camera capture |
| react-native-nfc-manager | uis/react-native | MIT | NFC plumbing |
| ort | services/rust-biometric | MIT / Apache-2.0 | ONNX runtime bindings for Rust |
| ndarray | services/rust-biometric | MIT / Apache-2.0 | tensor helpers (if needed) |
| org.jmrtd:jmrtd:0.8.3 | uis/react-native/android | **LGPL-3.0 — FLAGGED** | Used ONLY as an unmodified Gradle dependency (dynamic linking), industry-precedented usage; counsel sign-off TODO before store release |
| NFCPassportReader | uis/react-native/ios | MIT | iOS NFC passport reading |
| csca-masterlist-tools (logic reference) | services/python-csca-store | MIT | BSI Master List parsing; ICAO PKD public master list is NOT used (non-commercial terms) |
| asn1crypto | services/python-csca-store | MIT | ASN.1/CMS parsing for SOD verification |
| stb_image (vendored, pinned f056911) | services/rust-biometric/csrc | Public domain / MIT | JPEG/PNG decode shim; vendored, not a registry dep |

## Model weights

| Model | Source | License / provenance |
|---|---|---|
| AdaFace IR-50 (ONNX) | mk-minchul/AdaFace | Weights MIT. **Gray-zone disclosure:** trained on MS1MV2, a dataset whose redistribution terms are disputed. Zero-gray alternative: SFace (below), selectable via `FACE_MODEL=sface`. |
| SFace | opencv/opencv_zoo | Apache-2.0 — cleanest provenance, lower accuracy; fallback option |
| YuNet (face detection) | opencv/opencv_zoo | MIT |
| MiniFASNet (passive PAD) | minivision-ai | Apache-2.0. **Uncertified:** no ISO 30107-3 PAD Level 1/2 certification; must be described as "deterrence", never as certified liveness |
| MiDaS-small (depth signal) | isl-org | MIT |

## Removed for license compliance (wave 15)

- **InsightFace `buffalo_l` / `antelope` model packs** — previously referenced in
  `services/python-kyc-pipeline`; weights carry a signed NON-COMMERCIAL
  MODEL.LICENSE. All usage removed and replaced by AdaFace IR-50 / YuNet /
  SFace above. Do not reintroduce.

## Prohibited (do not add)

- `mrz` (PyPI) — GPLv3
- `mrz-scanner` — AGPL
- ICAO PKD public Master List download — non-commercial use terms
- Any commercial biometric SDK (iProov, FaceTec, Onfido SDK, etc.) — hooks
  removed in wave 15; platform is open-source-first.

## Certification honesty

No component in this stack confers ISO 30107-3 PAD Level 1/2 or iBeta
certification. Document-authenticity heuristics (moiré/specular/bezel/EXIF)
are uncertified risk signals that must never act as a sole accept/reject
gate; high-risk results step up to NFC chip authentication or manual review.
