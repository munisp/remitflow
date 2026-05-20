package com.remittance.models

data class LivenessResult(
    val is_live: Boolean,
    val confidence_score: Float,
    val face_match_score: Float,
    val checks_passed: List<String>,
    val checks_failed: List<String>
)
