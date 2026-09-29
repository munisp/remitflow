"""
RemitFlow KYC — Document Authenticity Heuristics (wave-15)

╔══════════════════════════════════════════════════════════════════════════╗
║ HONESTY NOTICE — READ BEFORE USING THESE SCORES                         ║
║                                                                          ║
║ This module is an UNCERTIFIED HEURISTIC RISK SIGNAL. It has NOT been     ║
║ benchmarked against any certified PAD / document-fraud dataset, and no   ║
║ accuracy figures are claimed or implied. Scores are meaningful only for  ║
║ in-distribution captures (smartphone photos of physical ID documents).   ║
║                                                                          ║
║ The output MUST NEVER be used as the sole gate for a KYC decision. It    ║
║ may only contribute to a risk score alongside hard gates (MRZ checksums, ║
║ MRZ↔VIZ cross-validation, liveness) and/or human review.                 ║
╚══════════════════════════════════════════════════════════════════════════╝

Signals combined into risk_score ∈ [0, 1] (higher = more suspicious):
  1. Moiré / FFT spectral peaks  — recapture of a screen shows periodic
     spectral peaks (screen pixel lattice interfering with camera sensor).
  2. Boundary-strip analysis     — the outer strip of a genuine document
     photo is background/desk; a flat, uniform, screen-like border suggests
     recapture from a display or a cropped digital image.
  3. Multi-frame specular/lamination cues — when several frames are given,
     genuine laminated documents produce moving specular highlights as the
     camera shifts; static highlights across frames suggest a flat print.
     (Optional signal — absent frames simply omit it; never fabricated.)
  4. Bezel / screen-edge detection — strong long straight edges framing the
     document region indicate a phone/monitor bezel (replay attack).
  5. EXIF anomalies — camera-captured images usually carry EXIF metadata;
     stripped or editor-software EXIF tags are a weak anomaly signal.

Verdict bands: risk_score < 0.33 → "low", < 0.66 → "medium", else "high".
"""

from __future__ import annotations

import io
import logging
from typing import Optional

import numpy as np

logger = logging.getLogger("kyc.authenticity")

UNCERTIFIED_NOTICE = (
    "uncertified heuristic risk signal; in-distribution only; "
    "never the sole gate for a KYC decision"
)


def _load_rgb(image_bytes: bytes) -> np.ndarray:
    from PIL import Image
    return np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))


def _load_gray(image_bytes: bytes) -> np.ndarray:
    from PIL import Image
    return np.array(Image.open(io.BytesIO(image_bytes)).convert("L"), dtype=float)


# ── Signal 1: Moiré / FFT spectral peaks ─────────────────────────────────────
def _moire_score(gray: np.ndarray) -> tuple[float, dict]:
    """
    Detect periodic spectral peaks characteristic of screen recapture.
    Returns (score 0..1, detail). Heuristic, uncertified.
    """
    h, w = gray.shape
    if h < 64 or w < 64:
        return 0.0, {"skipped": "image_too_small"}

    fft = np.fft.fftshift(np.fft.fft2(gray - gray.mean()))
    mag = np.log(np.abs(fft) + 1.0)

    cy, cx = h // 2, w // 2
    y, x = np.ogrid[:h, :w]
    r2 = (x - cx) ** 2 + (y - cy) ** 2
    inner = r2 <= (min(h, w) * 0.05) ** 2          # DC / very low freq
    outer = r2 >= (min(h, w) * 0.45) ** 2          # numerical noise floor
    band = ~(inner | outer)

    band_vals = mag[band]
    med = float(np.median(band_vals))
    # Count strong narrow peaks well above the local background.
    peaks = int(np.sum(band_vals > med + 2.5))
    peak_ratio = float(np.max(mag[band]) / (med + 1e-8))

    # More isolated high peaks → more likely a screen lattice.
    score = min(peaks / 40.0, 1.0) * 0.6 + min(max(peak_ratio - 1.0, 0.0) / 4.0, 1.0) * 0.4
    return round(min(score, 1.0), 4), {"spectral_peaks": peaks,
                                       "peak_ratio": round(peak_ratio, 3)}


# ── Signal 2: Boundary-strip analysis ────────────────────────────────────────
def _boundary_score(gray: np.ndarray) -> tuple[float, dict]:
    """
    A genuine document photo usually has a non-uniform background strip at
    the frame edges. A perfectly uniform or unnaturally saturated border
    suggests a cropped digital image or a screen filling the frame.
    Heuristic, uncertified.
    """
    h, w = gray.shape
    t = max(4, min(h, w) // 25)  # strip thickness ~4% of short side
    strips = np.concatenate([
        gray[:t, :].ravel(), gray[-t:, :].ravel(),
        gray[:, :t].ravel(), gray[:, -t:].ravel(),
    ])
    std = float(np.std(strips))
    mean = float(np.mean(strips))

    score = 0.0
    detail = {"border_std": round(std, 2), "border_mean": round(mean, 2)}
    if std < 3.0:
        score += 0.6            # suspiciously flat border
        detail["flat_border"] = True
    if mean > 235.0 or mean < 8.0:
        score += 0.4            # blown-out / black frame fill
        detail["saturated_border"] = True
    return round(min(score, 1.0), 4), detail


# ── Signal 3: Multi-frame specular / lamination cues ─────────────────────────
def _specular_score(gray_frames: list[np.ndarray]) -> tuple[float, dict]:
    """
    With ≥2 frames, compare the position of specular highlight blobs.
    Laminated genuine documents shift highlights as the camera moves;
    flat prints / screens keep them fixed. Single-frame captures omit this
    signal entirely (returns None) — it is never fabricated.
    """
    if len(gray_frames) < 2:
        return None, {"skipped": "need_at_least_2_frames"}

    centroids = []
    for gray in gray_frames[:6]:
        thresh = np.percentile(gray, 99.5)
        ys, xs = np.where(gray >= thresh)
        if len(xs) == 0:
            centroids.append(None)
            continue
        centroids.append((float(np.mean(xs)) / gray.shape[1],
                          float(np.mean(ys)) / gray.shape[0]))

    centroids = [c for c in centroids if c is not None]
    if len(centroids) < 2:
        return None, {"skipped": "no_highlight_detected"}

    disp = [np.hypot(centroids[i + 1][0] - centroids[i][0],
                     centroids[i + 1][1] - centroids[i][1])
            for i in range(len(centroids) - 1)]
    mean_disp = float(np.mean(disp))

    # No highlight movement at all across frames → suspicious (static print).
    # (Some movement is expected from handheld capture + lamination.)
    score = 1.0 - min(mean_disp / 0.02, 1.0)
    return round(score, 4), {"mean_highlight_displacement": round(mean_disp, 5),
                             "frames_used": len(centroids)}


# ── Signal 4: Bezel / screen-edge detection ──────────────────────────────────
def _bezel_score(gray: np.ndarray) -> tuple[float, dict]:
    """
    Detect long straight high-contrast lines parallel to the frame edges —
    the signature of a phone/monitor bezel in a replay attack.
    Heuristic, uncertified; implemented with numpy only (no cv2 Hough).
    """
    gy = np.abs(np.gradient(gray, axis=0))
    gx = np.abs(np.gradient(gray, axis=1))
    edge_thresh = np.percentile(np.concatenate([gy.ravel(), gx.ravel()]), 98)

    row_strength = (gy > edge_thresh).mean(axis=1)
    col_strength = (gx > edge_thresh).mean(axis=0)

    # A bezel edge runs most of the frame width/height.
    long_rows = int(np.sum(row_strength > 0.6))
    long_cols = int(np.sum(col_strength > 0.6))
    lines = long_rows + long_cols

    score = min(lines / 4.0, 1.0)
    return round(score, 4), {"long_horizontal_edges": long_rows,
                             "long_vertical_edges": long_cols}


# ── Signal 5: EXIF anomalies ─────────────────────────────────────────────────
def _exif_score(image_bytes: bytes) -> tuple[float, dict]:
    """
    Weak anomaly signal from metadata. No EXIF at all, or EXIF advertising
    editor software, is mildly suspicious for a claimed live capture.
    Absence of EXIF is COMMON after client-side re-encoding, so this signal
    is capped low. Heuristic, uncertified.
    """
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes))
        exif = img.getexif()
        fmt = (img.format or "").upper()
    except Exception as e:
        return 0.2, {"error": str(e)}

    if fmt in ("PNG", "GIF", "BMP"):
        # These formats rarely carry camera EXIF — signal is weak/neutral.
        return 0.2, {"note": f"format_{fmt}_no_camera_exif_expected"}

    if not exif:
        return 0.35, {"note": "exif_absent"}

    software = str(exif.get(305, ""))  # Software tag
    make = str(exif.get(271, ""))
    if software and any(k in software.lower() for k in
                        ("photoshop", "gimp", "paint", "editor", "canva")):
        return 0.8, {"software": software}
    if make:
        return 0.0, {"make": make}
    return 0.2, {"note": "exif_present_no_camera_make"}


# ── Aggregator ────────────────────────────────────────────────────────────────
_WEIGHTS = {"moire": 0.30, "boundary": 0.15, "specular": 0.20,
            "bezel": 0.20, "exif": 0.15}


def assess_authenticity(
    image_bytes: bytes,
    frame_bytes_list: Optional[list[bytes]] = None,
) -> dict:
    """
    Hybrid document-authenticity heuristic.

    Args:
        image_bytes:      primary document image (JPEG/PNG bytes).
        frame_bytes_list: OPTIONAL extra frames of the same document for
                          specular/lamination analysis. If omitted, that
                          signal is skipped and its weight redistributed.

    Returns:
        {
          "risk_score": float 0..1,       # higher = more suspicious
          "verdict":    "low"|"medium"|"high",
          "signals":    {...per-signal scores and details...},
          "simulated":  False,
          "uncertified": True,            # see module docstring
        }

    On any image-decode failure this returns success=False honestly; it
    never fabricates a passing score.
    """
    result = {
        "success":     False,
        "risk_score":  1.0,      # fail-suspicious, never fail-open
        "verdict":     "high",
        "signals":     {},
        "simulated":   False,
        "uncertified": True,
        "notice":      UNCERTIFIED_NOTICE,
    }

    try:
        gray = _load_gray(image_bytes)
    except Exception as e:
        logger.error(f"[Authenticity] primary image decode failed: {e}")
        result["error"] = f"decode_failed: {e}"
        return result

    signals: dict[str, tuple[Optional[float], dict]] = {}
    signals["moire"]    = _moire_score(gray)
    signals["boundary"] = _boundary_score(gray)
    signals["bezel"]    = _bezel_score(gray)
    signals["exif"]     = _exif_score(image_bytes)

    gray_frames = []
    for fb in (frame_bytes_list or [])[:6]:
        try:
            gray_frames.append(_load_gray(fb))
        except Exception as e:
            logger.warning(f"[Authenticity] skipping undecodable frame: {e}")
    signals["specular"] = _specular_score(gray_frames)

    # Weighted aggregate; redistribute weight of skipped (None) signals.
    total_w, acc = 0.0, 0.0
    out_signals = {}
    for name, (score, detail) in signals.items():
        out_signals[name] = {"score": score, **detail}
        if score is not None:
            w = _WEIGHTS[name]
            acc += w * score
            total_w += w

    risk = acc / total_w if total_w > 0 else 1.0
    risk = round(min(max(risk, 0.0), 1.0), 4)

    result.update({
        "success":    True,
        "risk_score": risk,
        "verdict":    "low" if risk < 0.33 else ("medium" if risk < 0.66 else "high"),
        "signals":    out_signals,
    })
    return result
