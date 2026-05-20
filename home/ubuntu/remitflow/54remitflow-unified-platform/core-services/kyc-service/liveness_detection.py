"""
Open-Source Liveness Detection Provider (v2)

Static image analysis:
- MediaPipe Face Mesh: 468 facial landmarks
- OpenCV: Texture analysis (LBP, frequency domain, moire detection)
- MiDaS: Monocular depth estimation to detect flat surfaces
- VLM (Ollama): Visual spoof detection

Active liveness (video-based challenge-response):
- Blink detection via EAR across consecutive frames
- Head turn detection via yaw angle changes
- Expression change via mouth aspect ratio
- Temporal consistency via face tracking stability

Face recognition:
- InsightFace/ArcFace: 512-dim face embeddings
- Fallback to MediaPipe landmark comparison
"""

import os
import io
import math
import hashlib
import logging
import tempfile
from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime
from dataclasses import dataclass, field

import threading

import httpx
import numpy as np

logger = logging.getLogger(__name__)

_model_lock = threading.Lock()
_mediapipe_face_mesh = None
_mediapipe_face_mesh_video = None
_arcface_app = None
_midas_model = None
_midas_transform = None

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

VLM_ENDPOINT = os.getenv("VLM_ENDPOINT", "http://localhost:11434/api/generate")
VLM_MODEL = os.getenv("VLM_MODEL", "llava:13b")
VLM_TIMEOUT = int(os.getenv("VLM_TIMEOUT", "120"))

LIVENESS_CONFIDENCE_THRESHOLD = float(os.getenv("LIVENESS_CONFIDENCE_THRESHOLD", "0.7"))
LIVENESS_USE_VLM = os.getenv("LIVENESS_USE_VLM", "true").lower() == "true"
LIVENESS_USE_DEPTH = os.getenv("LIVENESS_USE_DEPTH", "true").lower() == "true"

EAR_OPEN_THRESHOLD = float(os.getenv("EAR_OPEN_THRESHOLD", "0.21"))
EAR_BLINK_THRESHOLD = float(os.getenv("EAR_BLINK_THRESHOLD", "0.18"))
TEXTURE_LAPLACIAN_MIN = float(os.getenv("TEXTURE_LAPLACIAN_MIN", "80.0"))
TEXTURE_LAPLACIAN_MAX = float(os.getenv("TEXTURE_LAPLACIAN_MAX", "5000.0"))
MOIRE_THRESHOLD = float(os.getenv("MOIRE_THRESHOLD", "0.12"))
DEPTH_VARIANCE_MIN = float(os.getenv("DEPTH_VARIANCE_MIN", "0.015"))
FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.45"))
MIDAS_MODEL_TYPE = os.getenv("MIDAS_MODEL_TYPE", "MiDaS_small")
ARCFACE_MODEL_NAME = os.getenv("ARCFACE_MODEL_NAME", "buffalo_s")

ACTIVE_LIVENESS_MIN_FRAMES = int(os.getenv("ACTIVE_LIVENESS_MIN_FRAMES", "5"))
ACTIVE_LIVENESS_BLINK_REQUIRED = os.getenv("ACTIVE_LIVENESS_BLINK_REQUIRED", "true").lower() == "true"
ACTIVE_LIVENESS_HEAD_TURN_REQUIRED = os.getenv("ACTIVE_LIVENESS_HEAD_TURN_REQUIRED", "false").lower() == "true"

LEFT_EYE_INDICES = [362, 385, 387, 263, 373, 380]
RIGHT_EYE_INDICES = [33, 160, 158, 133, 153, 144]
MOUTH_INDICES = [78, 81, 13, 311, 308, 402, 14, 178]

FACE_OVAL_INDICES = [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
    397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
    172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
]


@dataclass
class LivenessSignal:
    name: str
    passed: bool
    confidence: float
    details: Dict[str, Any]


@dataclass
class LivenessResult:
    is_live: bool
    confidence_score: float
    face_match_score: float
    checks_passed: List[str]
    checks_failed: List[str]
    signals: List[LivenessSignal]
    provider: str = "opensource_liveness"
    provider_reference: Optional[str] = None
    raw_response: Optional[Dict[str, Any]] = None


def _eye_aspect_ratio(landmarks: List[Tuple[float, float]], indices: List[int]) -> float:
    p1 = landmarks[indices[0]]
    p2 = landmarks[indices[1]]
    p3 = landmarks[indices[2]]
    p4 = landmarks[indices[3]]
    p5 = landmarks[indices[4]]
    p6 = landmarks[indices[5]]

    vertical_1 = math.sqrt((p2[0] - p6[0]) ** 2 + (p2[1] - p6[1]) ** 2)
    vertical_2 = math.sqrt((p3[0] - p5[0]) ** 2 + (p3[1] - p5[1]) ** 2)
    horizontal = math.sqrt((p1[0] - p4[0]) ** 2 + (p1[1] - p4[1]) ** 2)

    if horizontal == 0:
        return 0.0
    return (vertical_1 + vertical_2) / (2.0 * horizontal)


def _mouth_aspect_ratio(landmarks: List[Tuple[float, float]]) -> float:
    top = landmarks[MOUTH_INDICES[2]]
    bottom = landmarks[MOUTH_INDICES[6]]
    left = landmarks[MOUTH_INDICES[0]]
    right = landmarks[MOUTH_INDICES[4]]

    vertical = math.sqrt((top[0] - bottom[0]) ** 2 + (top[1] - bottom[1]) ** 2)
    horizontal = math.sqrt((left[0] - right[0]) ** 2 + (left[1] - right[1]) ** 2)

    if horizontal == 0:
        return 0.0
    return vertical / horizontal


def _face_symmetry_score(landmarks: List[Tuple[float, float]]) -> float:
    nose_tip = landmarks[1]
    left_points = [landmarks[i] for i in [234, 93, 132, 58, 172, 136]]
    right_points = [landmarks[i] for i in [454, 323, 361, 288, 397, 365]]

    total_diff = 0.0
    count = 0
    for lp, rp in zip(left_points, right_points):
        left_dist = math.sqrt((lp[0] - nose_tip[0]) ** 2 + (lp[1] - nose_tip[1]) ** 2)
        right_dist = math.sqrt((rp[0] - nose_tip[0]) ** 2 + (rp[1] - nose_tip[1]) ** 2)
        if max(left_dist, right_dist) > 0:
            diff = abs(left_dist - right_dist) / max(left_dist, right_dist)
            total_diff += diff
            count += 1

    if count == 0:
        return 0.0
    avg_diff = total_diff / count
    return max(0.0, 1.0 - avg_diff * 2)


def _face_proportion_score(landmarks: List[Tuple[float, float]]) -> float:
    forehead = landmarks[10]
    chin = landmarks[152]
    left_cheek = landmarks[234]
    right_cheek = landmarks[454]

    face_height = math.sqrt((forehead[0] - chin[0]) ** 2 + (forehead[1] - chin[1]) ** 2)
    face_width = math.sqrt((left_cheek[0] - right_cheek[0]) ** 2 + (left_cheek[1] - right_cheek[1]) ** 2)

    if face_height == 0 or face_width == 0:
        return 0.0

    ratio = face_width / face_height
    ideal_ratio = 0.75
    deviation = abs(ratio - ideal_ratio) / ideal_ratio
    return max(0.0, 1.0 - deviation)


def _head_pose_from_landmarks(landmarks: List[Tuple[float, float]]) -> Dict[str, float]:
    nose_tip = landmarks[1]
    chin = landmarks[152]
    left_eye_outer = landmarks[33]
    right_eye_outer = landmarks[263]

    eye_center_x = (left_eye_outer[0] + right_eye_outer[0]) / 2
    eye_center_y = (left_eye_outer[1] + right_eye_outer[1]) / 2

    yaw_offset = (nose_tip[0] - eye_center_x)
    eye_width = abs(right_eye_outer[0] - left_eye_outer[0])
    yaw = (yaw_offset / eye_width * 90) if eye_width > 0 else 0

    pitch_offset = (nose_tip[1] - eye_center_y)
    face_height = abs(chin[1] - landmarks[10][1])
    pitch = (pitch_offset / face_height * 90 - 15) if face_height > 0 else 0

    roll_dy = right_eye_outer[1] - left_eye_outer[1]
    roll_dx = right_eye_outer[0] - left_eye_outer[0]
    roll = math.degrees(math.atan2(roll_dy, roll_dx)) if roll_dx != 0 else 0

    return {"yaw": yaw, "pitch": pitch, "roll": roll}


def _get_face_mesh_static():
    global _mediapipe_face_mesh
    if _mediapipe_face_mesh is None:
        with _model_lock:
            if _mediapipe_face_mesh is None:
                import mediapipe as mp
                _mediapipe_face_mesh = mp.solutions.face_mesh.FaceMesh(
                    static_image_mode=True,
                    max_num_faces=1,
                    refine_landmarks=True,
                    min_detection_confidence=0.5,
                )
                logger.info("MediaPipe FaceMesh (static) loaded")
    return _mediapipe_face_mesh


def _get_face_mesh_video():
    global _mediapipe_face_mesh_video
    if _mediapipe_face_mesh_video is None:
        with _model_lock:
            if _mediapipe_face_mesh_video is None:
                import mediapipe as mp
                _mediapipe_face_mesh_video = mp.solutions.face_mesh.FaceMesh(
                    static_image_mode=False,
                    max_num_faces=1,
                    refine_landmarks=True,
                    min_detection_confidence=0.5,
                    min_tracking_confidence=0.5,
                )
                logger.info("MediaPipe FaceMesh (video) loaded")
    return _mediapipe_face_mesh_video


def _get_arcface_app():
    global _arcface_app
    if _arcface_app is None:
        with _model_lock:
            if _arcface_app is None:
                from insightface.app import FaceAnalysis
                _arcface_app = FaceAnalysis(
                    name=ARCFACE_MODEL_NAME,
                    providers=["CPUExecutionProvider"],
                )
                _arcface_app.prepare(ctx_id=-1, det_size=(640, 640))
                logger.info("ArcFace model '%s' loaded", ARCFACE_MODEL_NAME)
    return _arcface_app


def _get_midas():
    global _midas_model, _midas_transform
    if _midas_model is None:
        with _model_lock:
            if _midas_model is None:
                import torch
                _midas_model = torch.hub.load(
                    "intel-isl/MiDaS", MIDAS_MODEL_TYPE, trust_repo=True
                )
                _midas_model.eval()
                transforms = torch.hub.load(
                    "intel-isl/MiDaS", "transforms", trust_repo=True
                )
                if MIDAS_MODEL_TYPE == "MiDaS_small":
                    _midas_transform = transforms.small_transform
                else:
                    _midas_transform = transforms.dpt_transform
                logger.info("MiDaS model '%s' loaded", MIDAS_MODEL_TYPE)
    return _midas_model, _midas_transform


class FaceMeshAnalyzer:
    def analyze(self, image_data: bytes) -> Dict[str, Any]:
        try:
            import mediapipe as mp
            import cv2

            nparr = np.frombuffer(image_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return {"face_detected": False, "error": "Could not decode image"}

            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            h, w = img.shape[:2]

            face_mesh = _get_face_mesh_static()

            results = face_mesh.process(rgb)

            if not results.multi_face_landmarks:
                return {"face_detected": False, "error": "No face detected in image"}

            face = results.multi_face_landmarks[0]
            landmarks = [(lm.x * w, lm.y * h) for lm in face.landmark]

            left_ear = _eye_aspect_ratio(landmarks, LEFT_EYE_INDICES)
            right_ear = _eye_aspect_ratio(landmarks, RIGHT_EYE_INDICES)
            avg_ear = (left_ear + right_ear) / 2.0
            mar = _mouth_aspect_ratio(landmarks)

            symmetry = _face_symmetry_score(landmarks)
            proportions = _face_proportion_score(landmarks)
            head_pose = _head_pose_from_landmarks(landmarks)

            oval_points = [landmarks[i] for i in FACE_OVAL_INDICES]
            xs = [p[0] for p in oval_points]
            ys = [p[1] for p in oval_points]
            face_bbox = {
                "x": min(xs) / w,
                "y": min(ys) / h,
                "width": (max(xs) - min(xs)) / w,
                "height": (max(ys) - min(ys)) / h,
            }
            face_area_ratio = face_bbox["width"] * face_bbox["height"]

            return {
                "face_detected": True,
                "landmark_count": len(landmarks),
                "eye_aspect_ratio": avg_ear,
                "left_ear": left_ear,
                "right_ear": right_ear,
                "mouth_aspect_ratio": mar,
                "symmetry_score": symmetry,
                "proportion_score": proportions,
                "head_pose": head_pose,
                "face_bbox": face_bbox,
                "face_area_ratio": face_area_ratio,
                "image_size": {"width": w, "height": h},
            }

        except ImportError:
            logger.warning("MediaPipe not installed, face mesh analysis unavailable")
            return {"face_detected": False, "error": "mediapipe not installed"}
        except Exception as e:
            logger.error("Face mesh analysis failed: %s", e)
            return {"face_detected": False, "error": str(e)}


class ActiveLivenessAnalyzer:

    def analyze_video(self, video_data: bytes) -> Dict[str, Any]:
        try:
            import cv2
            import mediapipe as mp

            with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
                tmp.write(video_data)
                tmp_path = tmp.name

            try:
                cap = cv2.VideoCapture(tmp_path)
                if not cap.isOpened():
                    return {"available": False, "error": "Could not open video"}

                fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                duration = total_frames / fps if fps > 0 else 0

                face_mesh = _get_face_mesh_video()

                ear_history: List[float] = []
                mar_history: List[float] = []
                yaw_history: List[float] = []
                face_detected_frames = 0
                frame_count = 0
                sample_interval = max(1, int(fps / 10))

                while True:
                    ret, frame = cap.read()
                    if not ret:
                        break
                    frame_count += 1

                    if frame_count % sample_interval != 0:
                        continue

                    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                    h, w = frame.shape[:2]
                    results = face_mesh.process(rgb)

                    if results.multi_face_landmarks:
                        face_detected_frames += 1
                        face = results.multi_face_landmarks[0]
                        landmarks = [(lm.x * w, lm.y * h) for lm in face.landmark]

                        left_ear = _eye_aspect_ratio(landmarks, LEFT_EYE_INDICES)
                        right_ear = _eye_aspect_ratio(landmarks, RIGHT_EYE_INDICES)
                        avg_ear = (left_ear + right_ear) / 2.0
                        ear_history.append(avg_ear)

                        mar = _mouth_aspect_ratio(landmarks)
                        mar_history.append(mar)

                        head_pose = _head_pose_from_landmarks(landmarks)
                        yaw_history.append(head_pose["yaw"])

                cap.release()
            finally:
                os.unlink(tmp_path)

            sampled_frames = len(ear_history)
            if sampled_frames < ACTIVE_LIVENESS_MIN_FRAMES:
                return {
                    "available": True,
                    "sufficient_frames": False,
                    "sampled_frames": sampled_frames,
                    "required_frames": ACTIVE_LIVENESS_MIN_FRAMES,
                    "error": f"Only {sampled_frames} frames with face detected, need {ACTIVE_LIVENESS_MIN_FRAMES}",
                }

            blinks = self._detect_blinks(ear_history)
            head_turns = self._detect_head_turns(yaw_history)
            expression_changes = self._detect_expression_changes(mar_history)

            face_tracking_ratio = face_detected_frames / max(frame_count // sample_interval, 1)

            ear_arr = np.array(ear_history)
            mar_arr = np.array(mar_history)
            yaw_arr = np.array(yaw_history)

            return {
                "available": True,
                "sufficient_frames": True,
                "total_frames": frame_count,
                "sampled_frames": sampled_frames,
                "duration_seconds": round(duration, 2),
                "fps": round(fps, 1),
                "face_tracking_ratio": round(face_tracking_ratio, 3),
                "blinks_detected": blinks["count"],
                "blink_frames": blinks["frames"],
                "head_turns_detected": head_turns["count"],
                "max_yaw_range": head_turns["max_range"],
                "expression_changes_detected": expression_changes["count"],
                "ear_stats": {
                    "mean": round(float(ear_arr.mean()), 4),
                    "std": round(float(ear_arr.std()), 4),
                    "min": round(float(ear_arr.min()), 4),
                    "max": round(float(ear_arr.max()), 4),
                },
                "mar_stats": {
                    "mean": round(float(mar_arr.mean()), 4),
                    "std": round(float(mar_arr.std()), 4),
                    "min": round(float(mar_arr.min()), 4),
                    "max": round(float(mar_arr.max()), 4),
                },
                "yaw_stats": {
                    "mean": round(float(yaw_arr.mean()), 2),
                    "std": round(float(yaw_arr.std()), 2),
                    "min": round(float(yaw_arr.min()), 2),
                    "max": round(float(yaw_arr.max()), 2),
                },
            }

        except ImportError:
            logger.warning("MediaPipe/OpenCV not installed, active liveness unavailable")
            return {"available": False, "error": "mediapipe or opencv not installed"}
        except Exception as e:
            logger.error(f"Active liveness analysis failed: {e}")
            return {"available": False, "error": str(e)}

    def _detect_blinks(self, ear_history: List[float]) -> Dict[str, Any]:
        blink_count = 0
        blink_frames: List[int] = []
        in_blink = False

        for i, ear in enumerate(ear_history):
            if ear < EAR_BLINK_THRESHOLD and not in_blink:
                in_blink = True
            elif ear > EAR_OPEN_THRESHOLD and in_blink:
                blink_count += 1
                blink_frames.append(i)
                in_blink = False

        return {"count": blink_count, "frames": blink_frames}

    def _detect_head_turns(self, yaw_history: List[float]) -> Dict[str, Any]:
        if len(yaw_history) < 3:
            return {"count": 0, "max_range": 0.0}

        yaw_arr = np.array(yaw_history)
        max_range = float(yaw_arr.max() - yaw_arr.min())

        direction_changes = 0
        for i in range(2, len(yaw_history)):
            prev_delta = yaw_history[i - 1] - yaw_history[i - 2]
            curr_delta = yaw_history[i] - yaw_history[i - 1]
            if abs(curr_delta) > 3 and abs(prev_delta) > 3:
                if (prev_delta > 0) != (curr_delta > 0):
                    direction_changes += 1

        turn_count = direction_changes // 2
        if max_range > 15:
            turn_count = max(turn_count, 1)

        return {"count": turn_count, "max_range": round(max_range, 2)}

    def _detect_expression_changes(self, mar_history: List[float]) -> Dict[str, Any]:
        if len(mar_history) < 3:
            return {"count": 0}

        mar_arr = np.array(mar_history)
        mar_range = float(mar_arr.max() - mar_arr.min())
        mar_std = float(mar_arr.std())

        change_count = 0
        if mar_range > 0.15:
            change_count += 1
        if mar_std > 0.05:
            change_count += 1

        return {"count": change_count, "range": round(mar_range, 4), "std": round(mar_std, 4)}


class TextureAnalyzer:
    def analyze(self, image_data: bytes) -> Dict[str, Any]:
        try:
            import cv2

            nparr = np.frombuffer(image_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return {"error": "Could not decode image"}

            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            h, w = gray.shape

            laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

            sobelx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
            sobely = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
            edge_density = float((np.sqrt(sobelx ** 2 + sobely ** 2) > 50).mean())

            f_transform = np.fft.fft2(gray.astype(np.float64))
            f_shift = np.fft.fftshift(f_transform)
            magnitude = np.log1p(np.abs(f_shift))
            cy, cx = h // 2, w // 2
            radius = min(h, w) // 4
            y_grid, x_grid = np.ogrid[:h, :w]
            high_mask = ((x_grid - cx) ** 2 + (y_grid - cy) ** 2) > radius ** 2
            high_freq_energy = float(magnitude[high_mask].mean()) if high_mask.any() else 0.0
            total_energy = float(magnitude.mean()) if magnitude.size > 0 else 1.0
            freq_ratio = high_freq_energy / total_energy if total_energy > 0 else 0.0

            moire_score = self._detect_moire(gray)

            lbp_image = np.zeros_like(gray, dtype=np.uint8)
            for bit_idx, (dy, dx) in enumerate(
                [(-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1)]
            ):
                shifted = np.roll(np.roll(gray, dy, axis=0), dx, axis=1)
                lbp_image = lbp_image + ((shifted >= gray).astype(np.uint8) << bit_idx)
            lbp_var = float(lbp_image.astype(np.float64).var())
            lbp_hist, _ = np.histogram(lbp_image.ravel(), bins=256, range=(0, 256))
            lbp_hist_norm = lbp_hist.astype(np.float64) / (lbp_hist.sum() + 1e-8)
            lbp_entropy = float(-np.sum(lbp_hist_norm[lbp_hist_norm > 0] * np.log2(lbp_hist_norm[lbp_hist_norm > 0])))

            hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
            saturation = hsv[:, :, 1]
            sat_mean = float(saturation.mean())
            sat_std = float(saturation.std())

            color_hist = []
            for ch in range(3):
                hist = cv2.calcHist([img], [ch], None, [32], [0, 256])
                color_hist.extend(hist.flatten().tolist())
            color_hist_arr = np.array(color_hist)
            color_uniformity = float(color_hist_arr.std() / (color_hist_arr.mean() + 1e-8))

            return {
                "laplacian_variance": laplacian_var,
                "edge_density": edge_density,
                "high_freq_ratio": freq_ratio,
                "moire_score": moire_score,
                "lbp_variance": lbp_var,
                "lbp_entropy": lbp_entropy,
                "saturation_mean": sat_mean,
                "saturation_std": sat_std,
                "color_uniformity": color_uniformity,
            }

        except ImportError:
            logger.warning("OpenCV not installed, texture analysis unavailable")
            return {"error": "opencv not installed"}
        except Exception as e:
            logger.error(f"Texture analysis failed: {e}")
            return {"error": str(e)}

    def _detect_moire(self, gray: "np.ndarray") -> float:
        h, w = gray.shape
        f_transform = np.fft.fft2(gray.astype(np.float64))
        f_shift = np.fft.fftshift(f_transform)
        magnitude = np.abs(f_shift)

        cy, cx = h // 2, w // 2
        inner_r = min(h, w) // 8
        outer_r = min(h, w) // 3
        y_grid, x_grid = np.ogrid[:h, :w]
        dist_sq = (x_grid - cx) ** 2 + (y_grid - cy) ** 2
        band_mask = (dist_sq >= inner_r ** 2) & (dist_sq <= outer_r ** 2)

        if not band_mask.any():
            return 0.0

        band_magnitudes = magnitude[band_mask]
        mean_mag = float(band_magnitudes.mean())
        if mean_mag == 0:
            return 0.0

        threshold = mean_mag * 5
        peak_count = int((band_magnitudes > threshold).sum())
        total_pixels = int(band_mask.sum())

        return peak_count / total_pixels if total_pixels > 0 else 0.0


class DepthAnalyzer:

    def analyze(self, image_data: bytes) -> Dict[str, Any]:
        try:
            import cv2
            import torch

            nparr = np.frombuffer(image_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return {"available": False, "error": "Could not decode image"}

            midas, transform = _get_midas()

            input_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            input_batch = transform(input_rgb)

            with torch.no_grad():
                prediction = midas(input_batch)
                prediction = torch.nn.functional.interpolate(
                    prediction.unsqueeze(1),
                    size=img.shape[:2],
                    mode="bicubic",
                    align_corners=False,
                ).squeeze()

            depth_map = prediction.cpu().numpy()

            depth_min = float(depth_map.min())
            depth_max = float(depth_map.max())
            depth_range = depth_max - depth_min
            depth_normalized = (depth_map - depth_min) / (depth_range + 1e-8)

            depth_mean = float(depth_normalized.mean())
            depth_std = float(depth_normalized.std())
            depth_variance = float(depth_normalized.var())

            h, w = depth_normalized.shape
            cy, cx = h // 2, w // 2
            face_region_h = h // 3
            face_region_w = w // 3
            face_depth = depth_normalized[
                max(0, cy - face_region_h):min(h, cy + face_region_h),
                max(0, cx - face_region_w):min(w, cx + face_region_w),
            ]
            face_depth_std = float(face_depth.std())
            face_depth_range = float(face_depth.max() - face_depth.min())

            grad_x = np.gradient(depth_normalized, axis=1)
            grad_y = np.gradient(depth_normalized, axis=0)
            gradient_magnitude = np.sqrt(grad_x ** 2 + grad_y ** 2)
            depth_gradient_mean = float(gradient_magnitude.mean())

            return {
                "available": True,
                "depth_mean": round(depth_mean, 4),
                "depth_std": round(depth_std, 4),
                "depth_variance": round(depth_variance, 6),
                "depth_range": round(float(depth_range), 2),
                "face_depth_std": round(face_depth_std, 4),
                "face_depth_range": round(face_depth_range, 4),
                "depth_gradient_mean": round(depth_gradient_mean, 6),
            }

        except ImportError as ie:
            logger.warning(f"MiDaS dependencies not installed ({ie}), depth analysis unavailable")
            return {"available": False, "error": f"Missing dependency: {ie}"}
        except Exception as e:
            logger.error(f"Depth analysis failed: {e}")
            return {"available": False, "error": str(e)}


class FaceRecognizer:

    def compare(self, selfie_data: bytes, reference_data: bytes) -> Dict[str, Any]:
        result = self._compare_arcface(selfie_data, reference_data)
        if result.get("method") == "arcface":
            return result
        return self._compare_mediapipe_fallback(selfie_data, reference_data)

    def _compare_arcface(self, selfie_data: bytes, reference_data: bytes) -> Dict[str, Any]:
        try:
            import cv2
            from insightface.app import FaceAnalysis

            app = _get_arcface_app()

            def _get_embedding(img_data: bytes) -> Optional[np.ndarray]:
                nparr = np.frombuffer(img_data, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if img is None:
                    return None
                faces = app.get(img)
                if not faces:
                    return None
                return faces[0].embedding

            selfie_emb = _get_embedding(selfie_data)
            ref_emb = _get_embedding(reference_data)

            if selfie_emb is None:
                return {"match_score": 0.0, "error": "No face detected in selfie", "method": "arcface"}
            if ref_emb is None:
                return {"match_score": 0.0, "error": "No face detected in reference", "method": "arcface"}

            selfie_norm = selfie_emb / (np.linalg.norm(selfie_emb) + 1e-8)
            ref_norm = ref_emb / (np.linalg.norm(ref_emb) + 1e-8)
            cosine_sim = float(np.dot(selfie_norm, ref_norm))
            match_score = max(0.0, min(1.0, (cosine_sim + 1) / 2))

            return {
                "match_score": round(match_score, 4),
                "cosine_similarity": round(cosine_sim, 4),
                "embedding_dim": len(selfie_emb),
                "method": "arcface",
            }

        except ImportError:
            logger.info("insightface not installed, falling back to MediaPipe landmarks")
            return {"method": "fallback"}
        except Exception as e:
            logger.warning(f"ArcFace comparison failed: {e}, falling back to MediaPipe")
            return {"method": "fallback"}

    def _compare_mediapipe_fallback(self, selfie_data: bytes, reference_data: bytes) -> Dict[str, Any]:
        try:
            import cv2
            import mediapipe as mp

            def _extract_embedding(img_data: bytes) -> Optional[np.ndarray]:
                nparr = np.frombuffer(img_data, np.uint8)
                img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if img is None:
                    return None
                rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

                face_mesh = _get_face_mesh_static()
                results = face_mesh.process(rgb)

                if not results.multi_face_landmarks:
                    return None

                face = results.multi_face_landmarks[0]
                key_indices = [
                    1, 33, 61, 199, 263, 291,
                    10, 152, 234, 454,
                    46, 53, 276, 283,
                    4, 6, 168,
                    78, 308, 14, 13,
                    70, 63, 105, 66, 107,
                    336, 296, 334, 293, 300,
                ]
                nose = face.landmark[1]
                embedding = []
                for idx in key_indices:
                    lm = face.landmark[idx]
                    embedding.extend([lm.x - nose.x, lm.y - nose.y, lm.z - nose.z])
                return np.array(embedding, dtype=np.float64)

            selfie_emb = _extract_embedding(selfie_data)
            ref_emb = _extract_embedding(reference_data)

            if selfie_emb is None:
                return {"match_score": 0.0, "error": "No face detected in selfie", "method": "mediapipe_landmarks"}
            if ref_emb is None:
                return {"match_score": 0.0, "error": "No face detected in reference", "method": "mediapipe_landmarks"}

            selfie_norm = selfie_emb / (np.linalg.norm(selfie_emb) + 1e-8)
            ref_norm = ref_emb / (np.linalg.norm(ref_emb) + 1e-8)
            cosine_sim = float(np.dot(selfie_norm, ref_norm))
            match_score = max(0.0, min(1.0, (cosine_sim + 1) / 2))

            return {
                "match_score": round(match_score, 4),
                "cosine_similarity": round(cosine_sim, 4),
                "embedding_dim": len(selfie_emb),
                "method": "mediapipe_landmarks",
            }

        except ImportError:
            logger.warning("MediaPipe not installed, face comparison unavailable")
            return {"match_score": 0.0, "error": "No face recognition library available", "method": "none"}
        except Exception as e:
            logger.error(f"MediaPipe face comparison failed: {e}")
            return {"match_score": 0.0, "error": str(e), "method": "mediapipe_landmarks"}


class VLMLivenessAnalyzer:
    async def analyze(self, image_data: bytes) -> Dict[str, Any]:
        import base64

        image_b64 = base64.b64encode(image_data).decode("utf-8")

        prompt = (
            "You are an expert face liveness detection system. Analyze this image to determine "
            "if it shows a REAL, LIVE person directly in front of the camera, or a SPOOF attempt.\n\n"
            "Analyze these specific indicators:\n"
            "1. SCREEN REPLAY: moire patterns, pixel grid, screen bezels, color banding\n"
            "2. PRINTED PHOTO: paper edges, creases, flat lighting, halftone dots\n"
            "3. 3D MASK: unnatural skin boundaries, rigid expressions, mask edges\n"
            "4. LIGHTING: natural 3D lighting vs flat 2D lighting\n"
            "5. SKIN TEXTURE: pores, fine lines vs print/screen artifacts\n"
            "6. 3D DEPTH: natural depth variation vs flat surface\n"
            "7. SPECULAR REFLECTIONS: natural highlights vs uniform reflections\n"
            "8. BACKGROUND: visible photo/screen edges, holding hands, stands\n\n"
            'Respond ONLY with a JSON object (no other text):\n'
            '{"is_live": true/false, "confidence": 0.0-1.0, '
            '"spoof_type": "none"/"print"/"screen"/"mask"/"video_replay"/"cutout"/"unknown", '
            '"indicators_found": ["indicator1"], '
            '"reasons": ["reason1"]}'
        )

        try:
            async with httpx.AsyncClient() as client:
                payload = {
                    "model": VLM_MODEL,
                    "prompt": prompt,
                    "images": [image_b64],
                    "stream": False,
                    "options": {"temperature": 0.1, "num_predict": 512},
                }
                response = await client.post(
                    VLM_ENDPOINT,
                    json=payload,
                    timeout=VLM_TIMEOUT,
                )
                response.raise_for_status()
                data = response.json()
                vlm_text = data.get("response", "")
                return self._parse_response(vlm_text)

        except httpx.ConnectError:
            logger.warning("VLM (Ollama) not reachable for liveness analysis, skipping")
            return {"available": False, "error": "VLM service not reachable"}
        except httpx.TimeoutException:
            logger.warning("VLM liveness analysis timed out")
            return {"available": False, "error": "VLM request timed out"}
        except Exception as e:
            logger.error(f"VLM liveness analysis failed: {e}")
            return {"available": False, "error": str(e)}

    def _parse_response(self, text: str) -> Dict[str, Any]:
        import json as json_module

        try:
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                parsed = json_module.loads(text[start:end])
                parsed["available"] = True
                return parsed
        except (json_module.JSONDecodeError, ValueError):
            pass

        text_lower = text.lower()
        spoof_keywords = ["spoof", "fake", "print", "screen", "mask", "not live", "not real", "attack"]
        live_keywords = ["live", "real", "genuine", "authentic"]

        spoof_score = sum(1 for kw in spoof_keywords if kw in text_lower)
        live_score = sum(1 for kw in live_keywords if kw in text_lower)

        is_live = live_score > spoof_score
        return {
            "available": True,
            "is_live": is_live,
            "confidence": 0.6 if (live_score != spoof_score) else 0.4,
            "spoof_type": "unknown" if not is_live else "none",
            "reasons": [text[:300]],
            "parse_fallback": True,
        }


async def download_image(url: str) -> bytes:
    async with httpx.AsyncClient(follow_redirects=True) as client:
        response = await client.get(url, timeout=30.0)
        response.raise_for_status()
        return response.content


def _evaluate_face_detection(face_data: Dict[str, Any]) -> LivenessSignal:
    if not face_data.get("face_detected"):
        return LivenessSignal(
            name="face_detection",
            passed=False,
            confidence=0.0,
            details={"error": face_data.get("error", "No face detected")},
        )

    face_area = face_data.get("face_area_ratio", 0)
    too_small = face_area < 0.02
    too_large = face_area > 0.85

    if too_small:
        return LivenessSignal(
            name="face_detection",
            passed=False,
            confidence=0.3,
            details={"face_area_ratio": face_area, "issue": "Face too small in frame"},
        )

    if too_large:
        return LivenessSignal(
            name="face_detection",
            passed=True,
            confidence=0.7,
            details={"face_area_ratio": face_area, "note": "Face very close to camera"},
        )

    return LivenessSignal(
        name="face_detection",
        passed=True,
        confidence=0.95,
        details={"face_area_ratio": face_area, "landmark_count": face_data.get("landmark_count", 0)},
    )


def _evaluate_eye_openness(face_data: Dict[str, Any]) -> LivenessSignal:
    if not face_data.get("face_detected"):
        return LivenessSignal(name="eye_analysis", passed=False, confidence=0.0, details={})

    ear = face_data.get("eye_aspect_ratio", 0)
    left_ear = face_data.get("left_ear", 0)
    right_ear = face_data.get("right_ear", 0)

    eyes_open = ear > EAR_OPEN_THRESHOLD
    ear_diff = abs(left_ear - right_ear)
    natural_asymmetry = ear_diff < 0.08

    conf = 0.8 if eyes_open else 0.4
    if natural_asymmetry:
        conf += 0.1

    return LivenessSignal(
        name="eye_analysis",
        passed=eyes_open,
        confidence=min(conf, 1.0),
        details={
            "average_ear": ear,
            "left_ear": left_ear,
            "right_ear": right_ear,
            "ear_threshold": EAR_OPEN_THRESHOLD,
            "eyes_open": eyes_open,
            "natural_asymmetry": natural_asymmetry,
        },
    )


def _evaluate_face_geometry(face_data: Dict[str, Any]) -> LivenessSignal:
    if not face_data.get("face_detected"):
        return LivenessSignal(name="face_geometry", passed=False, confidence=0.0, details={})

    symmetry = face_data.get("symmetry_score", 0)
    proportions = face_data.get("proportion_score", 0)
    head_pose = face_data.get("head_pose", {})

    yaw = abs(head_pose.get("yaw", 0))
    pitch = abs(head_pose.get("pitch", 0))
    roll = abs(head_pose.get("roll", 0))

    frontal = yaw < 30 and pitch < 25 and roll < 20
    good_symmetry = symmetry > 0.6
    good_proportions = proportions > 0.5

    score = 0.0
    if frontal:
        score += 0.4
    if good_symmetry:
        score += 0.3
    if good_proportions:
        score += 0.3

    return LivenessSignal(
        name="face_geometry",
        passed=score >= 0.6,
        confidence=score,
        details={
            "symmetry_score": symmetry,
            "proportion_score": proportions,
            "head_pose": head_pose,
            "frontal": frontal,
        },
    )


def _evaluate_texture(texture_data: Dict[str, Any]) -> LivenessSignal:
    if "error" in texture_data:
        return LivenessSignal(
            name="texture_analysis",
            passed=True,
            confidence=0.5,
            details={"error": texture_data["error"], "skipped": True},
        )

    laplacian = texture_data.get("laplacian_variance", 0)
    edge_density = texture_data.get("edge_density", 0)
    freq_ratio = texture_data.get("high_freq_ratio", 0)
    moire_score = texture_data.get("moire_score", 0)
    lbp_entropy = texture_data.get("lbp_entropy", 0)
    sat_std = texture_data.get("saturation_std", 0)

    spoof_indicators = 0
    indicator_details: Dict[str, Any] = {}

    in_sharpness_range = TEXTURE_LAPLACIAN_MIN < laplacian < TEXTURE_LAPLACIAN_MAX
    if not in_sharpness_range:
        spoof_indicators += 1
        indicator_details["sharpness"] = "too_low" if laplacian <= TEXTURE_LAPLACIAN_MIN else "too_high"

    if edge_density < 0.03:
        spoof_indicators += 1
        indicator_details["edge_detail"] = "low"

    if freq_ratio < 0.25:
        spoof_indicators += 1
        indicator_details["frequency_profile"] = "suspicious"

    if moire_score > MOIRE_THRESHOLD:
        spoof_indicators += 2
        indicator_details["moire_detected"] = True

    if lbp_entropy < 4.0:
        spoof_indicators += 1
        indicator_details["texture_entropy"] = "low"

    if sat_std < 10.0:
        spoof_indicators += 1
        indicator_details["color_flat"] = True

    max_possible = 8
    conf = max(0.0, 1.0 - (spoof_indicators / max_possible * 1.5))
    is_real = spoof_indicators <= 2

    return LivenessSignal(
        name="texture_analysis",
        passed=is_real,
        confidence=round(conf, 4),
        details={
            "laplacian_variance": laplacian,
            "in_sharpness_range": in_sharpness_range,
            "edge_density": edge_density,
            "high_freq_ratio": freq_ratio,
            "moire_score": moire_score,
            "lbp_entropy": lbp_entropy,
            "saturation_std": sat_std,
            "spoof_indicators": spoof_indicators,
            "indicator_details": indicator_details,
        },
    )


def _evaluate_depth(depth_data: Dict[str, Any]) -> LivenessSignal:
    if not depth_data.get("available"):
        return LivenessSignal(
            name="depth_analysis",
            passed=True,
            confidence=0.5,
            details={"skipped": True, "reason": depth_data.get("error", "Depth analysis not available")},
        )

    face_depth_std = depth_data.get("face_depth_std", 0)
    face_depth_range = depth_data.get("face_depth_range", 0)
    depth_gradient = depth_data.get("depth_gradient_mean", 0)

    has_3d_structure = face_depth_std > DEPTH_VARIANCE_MIN
    has_depth_range = face_depth_range > 0.05
    has_gradients = depth_gradient > 0.005

    passing_checks = sum([has_3d_structure, has_depth_range, has_gradients])

    if passing_checks >= 2:
        confidence = 0.7 + (passing_checks - 2) * 0.15
        passed = True
    elif passing_checks == 1:
        confidence = 0.45
        passed = False
    else:
        confidence = 0.2
        passed = False

    return LivenessSignal(
        name="depth_analysis",
        passed=passed,
        confidence=round(min(confidence, 1.0), 4),
        details={
            "face_depth_std": face_depth_std,
            "face_depth_range": face_depth_range,
            "depth_gradient_mean": depth_gradient,
            "has_3d_structure": has_3d_structure,
            "has_depth_range": has_depth_range,
            "has_gradients": has_gradients,
        },
    )


def _evaluate_active_liveness(active_data: Dict[str, Any]) -> LivenessSignal:
    if not active_data.get("available"):
        return LivenessSignal(
            name="active_liveness",
            passed=True,
            confidence=0.5,
            details={"skipped": True, "reason": active_data.get("error", "Video not provided")},
        )

    if not active_data.get("sufficient_frames"):
        return LivenessSignal(
            name="active_liveness",
            passed=False,
            confidence=0.2,
            details={"error": active_data.get("error", "Insufficient frames"), "skipped": False},
        )

    blinks = active_data.get("blinks_detected", 0)
    head_turns = active_data.get("head_turns_detected", 0)
    expression_changes = active_data.get("expression_changes_detected", 0)
    face_tracking = active_data.get("face_tracking_ratio", 0)

    ear_stats = active_data.get("ear_stats", {})
    ear_std = ear_stats.get("std", 0)
    yaw_stats = active_data.get("yaw_stats", {})
    yaw_range = yaw_stats.get("max", 0) - yaw_stats.get("min", 0)
    mar_stats = active_data.get("mar_stats", {})
    mar_std = mar_stats.get("std", 0)

    score = 0.0
    checks: Dict[str, bool] = {}

    if blinks >= 1:
        score += 0.30
        checks["blink_detected"] = True
    elif ear_std > 0.02:
        score += 0.10
        checks["eye_movement"] = True
    else:
        checks["blink_detected"] = False

    if head_turns >= 1 or yaw_range > 10:
        score += 0.20
        checks["head_movement"] = True
    else:
        checks["head_movement"] = False

    if expression_changes >= 1 or mar_std > 0.03:
        score += 0.15
        checks["expression_change"] = True
    else:
        checks["expression_change"] = False

    if face_tracking > 0.7:
        score += 0.20
        checks["consistent_tracking"] = True
    elif face_tracking > 0.4:
        score += 0.10
        checks["partial_tracking"] = True
    else:
        checks["tracking_poor"] = True

    if ear_std > 0.01 or mar_std > 0.01:
        score += 0.15
        checks["temporal_variation"] = True
    else:
        checks["temporal_variation"] = False

    if ACTIVE_LIVENESS_BLINK_REQUIRED and blinks == 0:
        score = min(score, 0.5)

    if ACTIVE_LIVENESS_HEAD_TURN_REQUIRED and head_turns == 0 and yaw_range < 10:
        score = min(score, 0.5)

    return LivenessSignal(
        name="active_liveness",
        passed=score >= 0.5,
        confidence=round(min(score, 1.0), 4),
        details={
            "blinks_detected": blinks,
            "head_turns_detected": head_turns,
            "expression_changes": expression_changes,
            "face_tracking_ratio": face_tracking,
            "ear_std": ear_std,
            "yaw_range": yaw_range,
            "mar_std": mar_std,
            "checks": checks,
        },
    )


def _evaluate_vlm(vlm_data: Dict[str, Any]) -> LivenessSignal:
    if not vlm_data.get("available"):
        return LivenessSignal(
            name="vlm_spoof_detection",
            passed=True,
            confidence=0.5,
            details={"skipped": True, "reason": vlm_data.get("error", "VLM not available")},
        )

    is_live = vlm_data.get("is_live", False)
    confidence = float(vlm_data.get("confidence", 0.5))
    spoof_type = vlm_data.get("spoof_type", "unknown")
    reasons = vlm_data.get("reasons", [])
    indicators = vlm_data.get("indicators_found", [])

    return LivenessSignal(
        name="vlm_spoof_detection",
        passed=is_live,
        confidence=confidence,
        details={
            "vlm_is_live": is_live,
            "spoof_type": spoof_type,
            "indicators_found": indicators,
            "reasons": reasons,
        },
    )


class OpenSourceLivenessProvider:
    def __init__(self):
        self.face_mesh = FaceMeshAnalyzer()
        self.active_liveness = ActiveLivenessAnalyzer()
        self.texture = TextureAnalyzer()
        self.depth = DepthAnalyzer()
        self.vlm = VLMLivenessAnalyzer()
        self.face_recognizer = FaceRecognizer()

    async def check_liveness(
        self,
        selfie_url: str,
        video_url: Optional[str] = None,
        reference_image_url: Optional[str] = None,
    ) -> LivenessResult:
        ref_id = hashlib.sha256(
            f"{selfie_url}:{datetime.utcnow().isoformat()}".encode()
        ).hexdigest()[:16]

        try:
            selfie_data = await download_image(selfie_url)
        except Exception as e:
            logger.error(f"Failed to download selfie: {e}")
            return LivenessResult(
                is_live=False,
                confidence_score=0.0,
                face_match_score=0.0,
                checks_passed=[],
                checks_failed=["selfie_download"],
                signals=[],
                provider_reference=ref_id,
                raw_response={"error": f"Failed to download selfie: {str(e)}"},
            )

        face_data = self.face_mesh.analyze(selfie_data)
        texture_data = self.texture.analyze(selfie_data)

        signals: List[LivenessSignal] = []

        signals.append(_evaluate_face_detection(face_data))
        signals.append(_evaluate_eye_openness(face_data))
        signals.append(_evaluate_face_geometry(face_data))
        signals.append(_evaluate_texture(texture_data))

        if LIVENESS_USE_DEPTH:
            depth_data = self.depth.analyze(selfie_data)
            signals.append(_evaluate_depth(depth_data))

        if LIVENESS_USE_VLM:
            vlm_data = await self.vlm.analyze(selfie_data)
            signals.append(_evaluate_vlm(vlm_data))

        if video_url:
            try:
                video_data = await download_image(video_url)
                active_data = self.active_liveness.analyze_video(video_data)
                signals.append(_evaluate_active_liveness(active_data))
            except Exception as e:
                logger.error(f"Active liveness analysis failed: {e}")
                signals.append(LivenessSignal(
                    name="active_liveness",
                    passed=True,
                    confidence=0.5,
                    details={"skipped": True, "error": str(e)},
                ))

        face_match_score = 0.0
        if reference_image_url:
            try:
                ref_data = await download_image(reference_image_url)
                comparison = self.face_recognizer.compare(selfie_data, ref_data)
                face_match_score = comparison.get("match_score", 0.0)
                signals.append(LivenessSignal(
                    name="face_match",
                    passed=face_match_score >= FACE_MATCH_THRESHOLD,
                    confidence=face_match_score,
                    details=comparison,
                ))
            except Exception as e:
                logger.error(f"Face comparison failed: {e}")
                signals.append(LivenessSignal(
                    name="face_match",
                    passed=False,
                    confidence=0.0,
                    details={"error": str(e)},
                ))

        checks_passed = [s.name for s in signals if s.passed]
        checks_failed = [s.name for s in signals if not s.passed]

        has_video = any(
            s.name == "active_liveness" and not s.details.get("skipped")
            for s in signals
        )
        has_depth = any(
            s.name == "depth_analysis" and not s.details.get("skipped")
            for s in signals
        )

        if has_video:
            weights = {
                "face_detection": 0.10,
                "eye_analysis": 0.05,
                "face_geometry": 0.05,
                "texture_analysis": 0.20,
                "depth_analysis": 0.10,
                "vlm_spoof_detection": 0.10,
                "active_liveness": 0.40,
            }
        elif has_depth:
            weights = {
                "face_detection": 0.15,
                "eye_analysis": 0.10,
                "face_geometry": 0.10,
                "texture_analysis": 0.25,
                "depth_analysis": 0.20,
                "vlm_spoof_detection": 0.20,
            }
        else:
            weights = {
                "face_detection": 0.20,
                "eye_analysis": 0.10,
                "face_geometry": 0.10,
                "texture_analysis": 0.30,
                "vlm_spoof_detection": 0.30,
            }

        total_weight = 0.0
        weighted_score = 0.0
        for signal in signals:
            if signal.name == "face_match":
                continue
            w = weights.get(signal.name, 0.05)
            weighted_score += signal.confidence * w
            total_weight += w

        confidence = weighted_score / total_weight if total_weight > 0 else 0.0

        is_live = (
            confidence >= LIVENESS_CONFIDENCE_THRESHOLD
            and "face_detection" in checks_passed
        )

        raw: Dict[str, Any] = {
            "face_analysis": face_data,
            "texture_analysis": texture_data,
            "has_video": has_video,
            "has_depth": has_depth,
            "weight_profile": "video" if has_video else ("depth" if has_depth else "basic"),
            "signals": [
                {"name": s.name, "passed": s.passed, "confidence": s.confidence}
                for s in signals
            ],
        }

        return LivenessResult(
            is_live=is_live,
            confidence_score=round(confidence, 4),
            face_match_score=round(face_match_score, 4),
            checks_passed=checks_passed,
            checks_failed=checks_failed,
            signals=signals,
            provider_reference=ref_id,
            raw_response=raw,
        )


def get_opensource_liveness_provider() -> OpenSourceLivenessProvider:
    return OpenSourceLivenessProvider()
