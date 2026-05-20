package com.remittance.networking

import com.remittance.models.LivenessResult
import okhttp3.MultipartBody
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part

interface LivenessApiService {
    @Multipart
    @POST("/v1/check-liveness")
    suspend fun checkLiveness(
        @Part selfie_image: MultipartBody.Part
    ): LivenessResult
}
