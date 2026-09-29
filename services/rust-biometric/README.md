# rust-biometric — REAL face embedding & matching service (wave 15)

Base64 image → stb_image decode → **YuNet** ONNX detection → similarity
alignment to 112×112 (ArcFace reference landmarks) → **AdaFace IR-50** ONNX
embedding → L2-normalized vector persisted in Postgres
(`biometric_embeddings`, drizzle `0095_kyc_wave15.sql`).

There is **no pseudo-embedding fallback**. The pre-wave-15 stub (SHA-256
hash pseudo-vectors in an in-memory HashMap) is deleted, along with the old
commented-out ArcFace/`buffalo_l` sketch — InsightFace `buffalo_l` weights
carry a NON-COMMERCIAL license and are prohibited (see
`THIRD-PARTY-NOTICES.md`).

## Model weights & license honesty

| Role | Model | License | Env |
|---|---|---|---|
| Detection | YuNet (opencv_zoo) | MIT | `YUNET_MODEL_PATH` |
| Embedding (default) | AdaFace IR-50 | Weights MIT; **gray zone:** trained on MS1MV2 whose redistribution terms are disputed | `ADAFACE_MODEL_PATH` |
| Embedding (zero-gray alternative) | SFace (opencv_zoo) | Apache-2.0; lower accuracy | `SFACE_MODEL_PATH` + `FACE_MODEL=sface` |

`FACE_MODEL=adaface` (default) selects AdaFace (512-d); `FACE_MODEL=sface`
selects SFace (128-d). Weights are NOT baked into the image — mount them and
point the env paths at them. **Missing or unloadable weights → the service
refuses to boot (fail closed).**

No accuracy claims are made here: tune `FACE_MATCH_THRESHOLD` /
`DEDUP_FLAG_THRESHOLD` against your own evaluation data.

## Fail-closed behavior

- Missing model weights / bad `FACE_MODEL` → boot aborts with a clear log.
- DB down or `DATABASE_URL` unset → data endpoints return **503**, `/health`
  reports `db_connected:false` + `status:degraded`, `/readyz` 503. The pool
  is evicted on connectivity errors and reconnected lazily; there is never
  an in-memory substitute.
- No face detected / undecodable image / model output shape mismatch → 4xx/5xx
  error, never a synthetic embedding.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | honest `model_loaded`, `db_connected`, thresholds |
| GET | `/readyz` `/livez` `/metrics` | probes + Prometheus |
| POST | `/embed` | `{user_id, image_base64, source?}` → embedding persisted (upsert on `"userId"`) |
| POST | `/verify` | 1:1 cosine vs stored row; threshold `FACE_MATCH_THRESHOLD` (default **0.35**) |
| POST | `/dedup-scan` | 1:N cosine in SQL (no pgvector) over same-model rows; matches ≥ `DEDUP_FLAG_THRESHOLD` (default **0.5**) returned as **review flags — never auto-block** |
| POST | `/biometric/enroll` `/biometric/match` `/biometric/dedup` | legacy pre-wave-15 shapes, same real pipeline. `/biometric/dedup` action is now `flag_for_review` (was `block_duplicate_identity`) |

Dedup SQL: embeddings are stored L2-normalized, so cosine == dot product,
computed over `double precision[]` via `generate_subscripts` against a probe
array; only rows of the same `model` and same dimension are comparable.

## Config

`PORT` (8149), `BIOMETRIC_HMAC_KEY` (**required**, no default),
`DATABASE_URL`, `FACE_MODEL`, `YUNET_MODEL_PATH`, `ADAFACE_MODEL_PATH`,
`SFACE_MODEL_PATH`, `FACE_MATCH_THRESHOLD` (0.35), `DEDUP_FLAG_THRESHOLD`
(0.5), `FACE_DET_SCORE_THRESHOLD` (0.7), `FACE_DET_MAX_DIM` (640, only used
for dynamic-shape YuNet exports; fixed-shape exports are resized to the
declared input size, mirroring OpenCV `FaceDetectorYN`).

## Build notes

- New Cargo deps: `ort` 2.0.0-rc (MIT/Apache-2.0), `ndarray` (MIT/Apache-2.0),
  `sqlx` 0.8.1 (MIT/Apache-2.0, repo-standard — same version/features as
  `rust-bmatch-engine`). Nothing else.
- Image decoding uses vendored **stb_image v2.30** (`csrc/stb_image.h`,
  pinned to nothings/stb `f0569113c93ad095470c54bf34a17b36646bbbb5`,
  public domain/MIT) compiled by `build.rs` with the system C compiler — no
  extra Cargo crate.
- `csrc/stb_shim.c` also forwards the glibc≥2.38 `__isoc23_strto*` symbols
  that the prebuilt ONNX Runtime static library references, so linking works
  on older glibc (C23 variants differ only in `0b`-literal handling, unused
  by ONNX Runtime). The Docker builder uses Debian trixie for
  libstdc++ ≥ GLIBCXX_3.4.31.
- Inference runs inside `tokio::task::spawn_blocking`; ONNX sessions sit
  behind mutexes (`Session::run` needs `&mut self`).

## Verified locally (dev gates)

`cargo check`, `cargo build`, `cargo fmt --check` pass. End-to-end smoke test
with the real YuNet + SFace ONNX weights and a live Postgres: enroll/verify
of the same person scored 1.0 / 0.9781 (JPEG re-crop variant), different
people scored 0.047 / −0.043 (correctly rejected at threshold 0.35);
dedup-scan flagged the enrolled duplicate at 1.0; DB-down produced 503s and
`db_connected:false`, with automatic recovery. AdaFace weights were not
downloadable in the dev sandbox (HuggingFace unreachable), so the AdaFace
path is compile-verified but only SFace was runtime-verified — validate
`FACE_MATCH_THRESHOLD` for AdaFace before production rollout.
