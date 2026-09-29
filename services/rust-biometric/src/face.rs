//! Face detection (YuNet ONNX) → similarity alignment to 112×112 →
//! embedding (AdaFace IR-50 / SFace ONNX). No pseudo-embeddings anywhere:
//! every failure is propagated as an error and endpoints fail closed.
//!
//! Model weights & licenses (see THIRD-PARTY-NOTICES.md):
//!   - YuNet (opencv_zoo, MIT) — env YUNET_MODEL_PATH
//!   - AdaFace IR-50 (weights MIT; trained on MS1MV2 whose redistribution
//!     terms are disputed — dataset-provenance gray zone) — env ADAFACE_MODEL_PATH
//!   - SFace (opencv_zoo, Apache-2.0, zero gray zone, lower accuracy) —
//!     env SFACE_MODEL_PATH, selected with FACE_MODEL=sface

use crate::imgdec::RgbImage;
use ndarray::Array4;
use ort::session::Session;
use ort::value::Tensor;

pub const ALIGNED_SIZE: usize = 112;

/// Which recognition model is active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelKind {
    AdaFace,
    SFace,
}

impl ModelKind {
    pub fn model_label(&self) -> &'static str {
        match self {
            ModelKind::AdaFace => "adaface-ir50",
            ModelKind::SFace => "sface",
        }
    }
    /// Output embedding dimensionality for the stock opencv_zoo/AdaFace exports.
    pub fn expected_dim(&self) -> usize {
        match self {
            ModelKind::AdaFace => 512,
            ModelKind::SFace => 128,
        }
    }
}

/// A detected face: bounding box + 5 landmarks in ORIGINAL image coordinates.
/// Landmark order matches YuNet/OpenCV and the ArcFace reference template:
/// [right eye, left eye, nose tip, right mouth corner, left mouth corner]
/// (subject-perspective right/left, i.e. 1:1 with ARCFACE_REF below).
#[derive(Debug, Clone)]
pub struct DetectedFace {
    pub score: f32,
    pub landmarks: [(f32, f32); 5],
}

/// ArcFace/AdaFace 112×112 reference landmark template (insightface
/// `arcface_dst`; same convention used by OpenCV's FaceRecognizerSF align).
const ARCFACE_REF: [[f32; 2]; 5] = [
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
];

/// Bilinear resize (used only to bound YuNet input size; landmarks are
/// rescaled back to original coordinates afterwards).
fn resize_bilinear(img: &RgbImage, new_w: usize, new_h: usize) -> RgbImage {
    let mut out = vec![0u8; new_w * new_h * 3];
    let sx = img.width as f64 / new_w as f64;
    let sy = img.height as f64 / new_h as f64;
    for y in 0..new_h {
        let fy = (y as f64 + 0.5) * sy - 0.5;
        let y0 = fy.floor().clamp(0.0, (img.height - 1) as f64) as usize;
        let y1 = (y0 + 1).min(img.height - 1);
        let wy = (fy - y0 as f64).clamp(0.0, 1.0);
        for x in 0..new_w {
            let fx = (x as f64 + 0.5) * sx - 0.5;
            let x0 = fx.floor().clamp(0.0, (img.width - 1) as f64) as usize;
            let x1 = (x0 + 1).min(img.width - 1);
            let wx = (fx - x0 as f64).clamp(0.0, 1.0);
            for c in 0..3 {
                let i00 = (y0 * img.width + x0) * 3 + c;
                let i01 = (y0 * img.width + x1) * 3 + c;
                let i10 = (y1 * img.width + x0) * 3 + c;
                let i11 = (y1 * img.width + x1) * 3 + c;
                let v = img.data[i00] as f64 * (1.0 - wx) * (1.0 - wy)
                    + img.data[i01] as f64 * wx * (1.0 - wy)
                    + img.data[i10] as f64 * (1.0 - wx) * wy
                    + img.data[i11] as f64 * wx * wy;
                out[(y * new_w + x) * 3 + c] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    RgbImage {
        width: new_w,
        height: new_h,
        data: out,
    }
}

/// A decoded YuNet candidate in MODEL-input pixel coordinates.
struct Candidate {
    score: f32,
    x1: f32,
    y1: f32,
    w: f32,
    h: f32,
    lmk: [(f32, f32); 5],
}

fn iou(a: &Candidate, b: &Candidate) -> f32 {
    let ax2 = a.x1 + a.w;
    let ay2 = a.y1 + a.h;
    let bx2 = b.x1 + b.w;
    let by2 = b.y1 + b.h;
    let ix1 = a.x1.max(b.x1);
    let iy1 = a.y1.max(b.y1);
    let ix2 = ax2.min(bx2);
    let iy2 = ay2.min(by2);
    let iw = (ix2 - ix1).max(0.0);
    let ih = (iy2 - iy1).max(0.0);
    let inter = iw * ih;
    let union = a.w * a.h + b.w * b.h - inter;
    if union <= 0.0 {
        0.0
    } else {
        inter / union
    }
}

/// Classic score-descending NMS (mirrors OpenCV NMSBoxes, threshold 0.3).
fn nms(mut cands: Vec<Candidate>, iou_threshold: f32) -> Vec<Candidate> {
    cands.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut keep: Vec<Candidate> = Vec::with_capacity(cands.len().min(8));
    for c in cands {
        if keep.iter().all(|k| iou(k, &c) < iou_threshold) {
            keep.push(c);
        }
    }
    keep
}

/// Run YuNet and return the best face after decode + NMS (selfie/ID flows
/// are single-face; the number of post-NMS faces is returned for logging).
///
/// The opencv_zoo YuNet ONNX export has RAW outputs (no fused decode):
///   input  "input": [1, 3, H, W] float32, **BGR**, raw 0..255
///   outputs (per stride s in {8,16,32}):
///     cls_s  [1, H/s*W/s, 1], obj_s [1, N, 1],
///     bbox_s [1, N, 4] (dx, dy, log w, log h), kps_s [1, N, 10]
/// Decode mirrors OpenCV modules/objdetect/src/face_detect.cpp postProcess():
///   score = sqrt(clamp(cls,0,1) * clamp(obj,0,1))
///   cx = (col + dx) * s, cy = (row + dy) * s, w = exp(dw) * s, h = exp(dh) * s
///   lmk_n = ((kps[2n] + col) * s, (kps[2n+1] + row) * s)
///   then IoU-NMS at 0.3.
pub fn detect_face(
    session: &mut Session,
    img: &RgbImage,
    score_threshold: f32,
    max_det_dim: usize,
) -> Result<(DetectedFace, usize), String> {
    // opencv_zoo YuNet ONNX exports are FIXED-shape (e.g. 640×640). OpenCV's
    // FaceDetectorYN wrapper handles arbitrary photos by stretching the input
    // to the model's declared size and scaling coordinates back; we mirror
    // that. If the export is dynamic-shaped, we instead bound the input to
    // max_det_dim with a uniform scale.
    let declared_hw = match session.inputs()[0].dtype() {
        ort::value::ValueType::Tensor { shape, .. }
            if shape.len() == 4 && shape[2] > 0 && shape[3] > 0 =>
        {
            Some((shape[2] as usize, shape[3] as usize)) // (H, W)
        }
        _ => None,
    };

    let (work, scale_x, scale_y) = match declared_hw {
        Some((mh, mw)) => {
            if (mw, mh) == (img.width, img.height) {
                (
                    RgbImage {
                        width: img.width,
                        height: img.height,
                        data: img.data.clone(),
                    },
                    1.0_f32,
                    1.0_f32,
                )
            } else {
                let r = resize_bilinear(img, mw, mh);
                let sx = img.width as f32 / mw as f32;
                let sy = img.height as f32 / mh as f32;
                (r, sx, sy)
            }
        }
        None => {
            if img.width.max(img.height) > max_det_dim {
                let s = max_det_dim as f64 / img.width.max(img.height) as f64;
                let nw = ((img.width as f64 * s).round() as usize).max(32);
                let nh = ((img.height as f64 * s).round() as usize).max(32);
                let back = img.width as f32 / nw as f32;
                (resize_bilinear(img, nw, nh), back, back)
            } else {
                (
                    RgbImage {
                        width: img.width,
                        height: img.height,
                        data: img.data.clone(),
                    },
                    1.0_f32,
                    1.0_f32,
                )
            }
        }
    };

    let (w, h) = (work.width, work.height);
    let mut arr = Array4::<f32>::zeros((1, 3, h, w));
    for y in 0..h {
        for x in 0..w {
            let (r, g, b) = work.pixel(x, y);
            // OpenCV blobFromImage default: keeps BGR order, scale=1, mean=0.
            arr[[0, 0, y, x]] = b as f32;
            arr[[0, 1, y, x]] = g as f32;
            arr[[0, 2, y, x]] = r as f32;
        }
    }

    let input_name = session.inputs()[0].name().to_string();
    // Capture output names before run() — SessionOutputs borrows the session.
    let output_names: Vec<String> = session
        .outputs()
        .iter()
        .map(|o| o.name().to_string())
        .collect();
    let tensor = Tensor::from_array(arr).map_err(|e| format!("detector tensor: {e}"))?;
    let outputs = session
        .run(ort::inputs![input_name => tensor])
        .map_err(|e| format!("YuNet inference failed: {e}"))?;

    // Extract raw per-stride heads by name (fail closed if the export differs).
    let strides = [8usize, 16, 32];
    let mut heads: Vec<(&[f32], &[f32], &[f32], &[f32], usize)> = Vec::new(); // cls, obj, bbox, kps, stride
    for &s in &strides {
        let get = |name: &str, width: usize| -> Result<&[f32], String> {
            let v = outputs.get(name).ok_or_else(|| {
                format!("YuNet output '{name}' not found (available: {output_names:?})")
            })?;
            let (shape, data) = v
                .try_extract_tensor::<f32>()
                .map_err(|e| format!("YuNet output '{name}' extract: {e}"))?;
            let n = (h / s) * (w / s);
            let expected = n * width;
            if data.len() != expected {
                return Err(format!(
                    "YuNet output '{name}' has {} values, expected {expected} for {}x{} input (shape {shape:?})",
                    data.len(), w, h
                ));
            }
            Ok(data)
        };
        heads.push((
            get(&format!("cls_{s}"), 1)?,
            get(&format!("obj_{s}"), 1)?,
            get(&format!("bbox_{s}"), 4)?,
            get(&format!("kps_{s}"), 10)?,
            s,
        ));
    }

    // Decode candidates in model-input coordinates.
    let mut cands: Vec<Candidate> = Vec::new();
    for (cls, obj, bbox, kps, s) in &heads {
        let cols = w / s;
        let rows = h / s;
        for r in 0..rows {
            for c in 0..cols {
                let idx = r * cols + c;
                let cls_score = cls[idx].clamp(0.0, 1.0);
                let obj_score = obj[idx].clamp(0.0, 1.0);
                let score = (cls_score * obj_score).sqrt();
                if score < score_threshold {
                    continue;
                }
                let sf = *s as f32;
                let cx = (c as f32 + bbox[idx * 4]) * sf;
                let cy = (r as f32 + bbox[idx * 4 + 1]) * sf;
                let bw = bbox[idx * 4 + 2].exp() * sf;
                let bh = bbox[idx * 4 + 3].exp() * sf;
                let mut lmk = [(0.0f32, 0.0f32); 5];
                for k in 0..5 {
                    lmk[k] = (
                        (kps[idx * 10 + 2 * k] + c as f32) * sf,
                        (kps[idx * 10 + 2 * k + 1] + r as f32) * sf,
                    );
                }
                cands.push(Candidate {
                    score,
                    x1: cx - bw / 2.0,
                    y1: cy - bh / 2.0,
                    w: bw,
                    h: bh,
                    lmk,
                });
            }
        }
    }

    let kept = nms(cands, 0.3);
    let n_faces = kept.len();
    match kept.into_iter().next() {
        Some(f) => Ok((
            DetectedFace {
                score: f.score,
                // back to original image coordinates
                landmarks: f.lmk.map(|(x, y)| (x * scale_x, y * scale_y)),
            },
            n_faces,
        )),
        None => Err(format!(
            "no face detected above score threshold {score_threshold:.2} (fail closed)"
        )),
    }
}

// ── Alignment ────────────────────────────────────────────────────────────────

/// Similarity transform (uniform scale + rotation + translation) mapping
/// image coordinates → 112×112 template coordinates:
///   dst = (a*x - b*y + tx, b*x + a*y + ty)
struct Similarity {
    a: f64,
    b: f64,
    tx: f64,
    ty: f64,
}

/// Least-squares similarity fit (Umeyama, no reflection) src → dst using the
/// 5 landmarks. Closed form via complex arithmetic: w_i ≈ c·z_i + t.
fn estimate_similarity(src: &[(f32, f32); 5], dst: &[[f32; 2]; 5]) -> Result<Similarity, String> {
    let n = src.len() as f64;
    let (mut mx_s, mut my_s, mut mx_d, mut my_d) = (0.0, 0.0, 0.0, 0.0);
    for i in 0..5 {
        mx_s += src[i].0 as f64;
        my_s += src[i].1 as f64;
        mx_d += dst[i][0] as f64;
        my_d += dst[i][1] as f64;
    }
    let (mx_s, my_s, mx_d, my_d) = (mx_s / n, my_s / n, mx_d / n, my_d / n);

    // c = Σ (w - μ_w)·conj(z - μ_z) / Σ |z - μ_z|²
    let (mut num_re, mut num_im, mut den) = (0.0, 0.0, 0.0);
    for i in 0..5 {
        let zx = src[i].0 as f64 - mx_s;
        let zy = src[i].1 as f64 - my_s;
        let wx = dst[i][0] as f64 - mx_d;
        let wy = dst[i][1] as f64 - my_d;
        num_re += wx * zx + wy * zy;
        num_im += wy * zx - wx * zy;
        den += zx * zx + zy * zy;
    }
    if den < 1e-8 {
        return Err("degenerate landmarks (all coincident) — cannot align".to_string());
    }
    let a = num_re / den;
    let b = num_im / den;
    // t = μ_w - c·μ_z
    let tx = mx_d - (a * mx_s - b * my_s);
    let ty = my_d - (b * mx_s + a * my_s);
    Ok(Similarity { a, b, tx, ty })
}

/// Warp the face into the 112×112 ArcFace template (RGB888 out), inverse
/// mapping + bilinear sampling with edge clamping.
pub fn align_face(img: &RgbImage, face: &DetectedFace) -> Result<Vec<u8>, String> {
    let m = estimate_similarity(&face.landmarks, &ARCFACE_REF)?;
    // Inverse: z = (w - t)·conj(c)/|c|²  where c = a + ib
    let norm = m.a * m.a + m.b * m.b;
    if norm < 1e-12 {
        return Err("degenerate similarity transform".to_string());
    }
    let ia = m.a / norm;
    let ib = -m.b / norm;

    let mut out = vec![0u8; ALIGNED_SIZE * ALIGNED_SIZE * 3];
    for py in 0..ALIGNED_SIZE {
        for px in 0..ALIGNED_SIZE {
            let dx = px as f64 - m.tx;
            let dy = py as f64 - m.ty;
            let sx = ia * dx - ib * dy;
            let sy = ib * dx + ia * dy;

            let x0 = sx.floor().clamp(0.0, (img.width - 1) as f64) as usize;
            let y0 = sy.floor().clamp(0.0, (img.height - 1) as f64) as usize;
            let x1 = (x0 + 1).min(img.width - 1);
            let y1 = (y0 + 1).min(img.height - 1);
            let wx = (sx - x0 as f64).clamp(0.0, 1.0);
            let wy = (sy - y0 as f64).clamp(0.0, 1.0);
            for c in 0..3 {
                let i00 = (y0 * img.width + x0) * 3 + c;
                let i01 = (y0 * img.width + x1) * 3 + c;
                let i10 = (y1 * img.width + x0) * 3 + c;
                let i11 = (y1 * img.width + x1) * 3 + c;
                let v = img.data[i00] as f64 * (1.0 - wx) * (1.0 - wy)
                    + img.data[i01] as f64 * wx * (1.0 - wy)
                    + img.data[i10] as f64 * (1.0 - wx) * wy
                    + img.data[i11] as f64 * wx * wy;
                out[(py * ALIGNED_SIZE + px) * 3 + c] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
    Ok(out)
}

// ── Embedding ────────────────────────────────────────────────────────────────

/// Run the recognition model on an aligned 112×112 RGB face.
/// Preprocessing conventions (matching each model's reference pipeline):
///   - AdaFace IR-50: RGB, (v − 127.5) / 127.5   (insightface convention)
///   - SFace:         RGB, raw 0..255             (OpenCV FaceRecognizerSF:
///                    blobFromImage(img, 1, (112,112), 0, swapRB=true))
/// Output is L2-normalized so cosine similarity == dot product everywhere
/// (including the SQL-side dedup scan).
pub fn compute_embedding(
    session: &mut Session,
    aligned_rgb: &[u8],
    kind: ModelKind,
) -> Result<Vec<f64>, String> {
    if aligned_rgb.len() != ALIGNED_SIZE * ALIGNED_SIZE * 3 {
        return Err(format!(
            "aligned face must be {} bytes, got {}",
            ALIGNED_SIZE * ALIGNED_SIZE * 3,
            aligned_rgb.len()
        ));
    }

    let mut arr = Array4::<f32>::zeros((1, 3, ALIGNED_SIZE, ALIGNED_SIZE));
    for y in 0..ALIGNED_SIZE {
        for x in 0..ALIGNED_SIZE {
            let i = (y * ALIGNED_SIZE + x) * 3;
            let (r, g, b) = (
                aligned_rgb[i] as f32,
                aligned_rgb[i + 1] as f32,
                aligned_rgb[i + 2] as f32,
            );
            match kind {
                ModelKind::AdaFace => {
                    arr[[0, 0, y, x]] = (r - 127.5) / 127.5;
                    arr[[0, 1, y, x]] = (g - 127.5) / 127.5;
                    arr[[0, 2, y, x]] = (b - 127.5) / 127.5;
                }
                ModelKind::SFace => {
                    arr[[0, 0, y, x]] = r;
                    arr[[0, 1, y, x]] = g;
                    arr[[0, 2, y, x]] = b;
                }
            }
        }
    }

    let input_name = session.inputs()[0].name().to_string();
    let tensor = Tensor::from_array(arr).map_err(|e| format!("recognizer tensor: {e}"))?;
    let outputs = session
        .run(ort::inputs![input_name => tensor])
        .map_err(|e| format!("{} inference failed: {e}", kind.model_label()))?;
    let (shape, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| format!("{} output extract: {e}", kind.model_label()))?;

    let dims: Vec<i64> = shape.iter().copied().collect();
    let flat_len = dims.iter().product::<i64>() as usize;
    let expected = kind.expected_dim();
    if flat_len != expected || data.len() != expected {
        return Err(format!(
            "{} output shape {dims:?} — expected a {expected}-d embedding (fail closed)",
            kind.model_label()
        ));
    }

    // L2-normalize → unit hypersphere; cosine == dot from here on.
    let norm: f64 = data
        .iter()
        .map(|&v| (v as f64) * (v as f64))
        .sum::<f64>()
        .sqrt();
    if norm < 1e-8 {
        return Err("model returned a zero embedding (fail closed)".to_string());
    }
    Ok(data.iter().map(|&v| (v as f64) / norm).collect())
}

/// Cosine similarity between two L2-normalized embeddings (= dot product).
pub fn cosine_similarity(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}
