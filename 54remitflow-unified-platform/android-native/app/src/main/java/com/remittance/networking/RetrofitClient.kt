package com.remittance.networking

import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

object RetrofitClient {
    private const val LIVENESS_BASE_URL = "http://10.0.2.2:8090/"

    val livenessInstance: Retrofit by lazy {
        Retrofit.Builder()
            .baseUrl(LIVENESS_BASE_URL)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }
}
