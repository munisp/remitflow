package com.remittance.viewmodels

import android.content.Context
import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.remittance.networking.LivenessApiService
import com.remittance.networking.RetrofitClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream

sealed class LivenessState {
    object Idle : LivenessState()
    object Loading : LivenessState()
    data class Success(val isLive: Boolean, val confidence: Float) : LivenessState()
    data class Error(val message: String) : LivenessState()
}

class LivenessViewModel : ViewModel() {

    private val _livenessState = MutableStateFlow<LivenessState>(LivenessState.Idle)
    val livenessState: StateFlow<LivenessState> = _livenessState

    private val livenessApiService: LivenessApiService by lazy {
        RetrofitClient.livenessInstance.create(LivenessApiService::class.java)
    }

    fun checkLiveness(context: Context, selfieBitmap: Bitmap) {
        viewModelScope.launch {
            _livenessState.value = LivenessState.Loading
            try {
                val stream = ByteArrayOutputStream()
                selfieBitmap.compress(Bitmap.CompressFormat.JPEG, 100, stream)
                val byteArray = stream.toByteArray()

                val requestFile = byteArray.toRequestBody("image/jpeg".toMediaTypeOrNull(), 0, byteArray.size)
                val body = MultipartBody.Part.createFormData("selfie_image", "selfie.jpg", requestFile)

                val response = livenessApiService.checkLiveness(body)

                if (response.is_live) {
                    _livenessState.value = LivenessState.Success(response.is_live, response.confidence_score)
                } else {
                    _livenessState.value = LivenessState.Error("Liveness check failed. Please try again.")
                }
            } catch (e: Exception) {
                _livenessState.value = LivenessState.Error(e.message ?: "An unknown error occurred.")
            }
        }
    }
}
