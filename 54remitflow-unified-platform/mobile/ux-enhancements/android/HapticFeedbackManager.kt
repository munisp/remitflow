package com.remittance.app.ux

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.HapticFeedbackConstants
import android.view.View

/**
 * Comprehensive Haptic Feedback Manager for Android
 * Provides contextual tactile responses for all user interactions
 */
class HapticFeedbackManager(private val context: Context) {
    
    private val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        vibratorManager.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    
    companion object {
        @Volatile
        private var instance: HapticFeedbackManager? = null
        
        fun getInstance(context: Context): HapticFeedbackManager {
            return instance ?: synchronized(this) {
                instance ?: HapticFeedbackManager(context.applicationContext).also { instance = it }
            }
        }
    }
    
    // MARK: - Basic Haptics
    
    /** Light feedback for button presses and taps */
    fun lightImpact() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
        } else {
            vibrate(10, 50)
        }
    }
    
    /** Medium feedback for selections and toggles */
    fun mediumImpact() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
        } else {
            vibrate(20, 100)
        }
    }
    
    /** Heavy feedback for confirmations and important actions */
    fun heavyImpact() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_HEAVY_CLICK))
        } else {
            vibrate(30, 150)
        }
    }
    
    /** Selection feedback for scrolling and picking */
    fun selection() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
        } else {
            vibrate(5, 30)
        }
    }
    
    // MARK: - Notification Haptics
    
    /** Success vibration for completed transactions */
    fun success() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_DOUBLE_CLICK))
        } else {
            vibratePattern(longArrayOf(0, 50, 50, 100), -1)
        }
    }
    
    /** Warning pattern for alerts */
    fun warning() {
        vibratePattern(longArrayOf(0, 100, 100, 100, 100, 100), -1)
    }
    
    /** Error pattern for failures */
    fun error() {
        vibratePattern(longArrayOf(0, 200, 100, 200), -1)
    }
    
    // MARK: - Custom Patterns
    
    /** Transaction completed pattern */
    fun transactionCompleted() {
        vibratePattern(longArrayOf(0, 80, 50, 120), -1)
    }
    
    /** Money sent pattern */
    fun moneySent() {
        vibratePattern(longArrayOf(0, 60, 40, 40), -1)
    }
    
    /** Money received pattern */
    fun moneyReceived() {
        vibratePattern(longArrayOf(0, 50, 40, 70, 40, 90), -1)
    }
    
    /** Biometric authentication success */
    fun biometricSuccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
        } else {
            vibrate(70, 120)
        }
    }
    
    /** Pull to refresh */
    fun pullToRefresh() {
        vibrate(10, 40)
    }
    
    // MARK: - Helper Methods
    
    private fun vibrate(duration: Long, amplitude: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(duration, amplitude))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(duration)
        }
    }
    
    private fun vibratePattern(pattern: LongArray, repeat: Int) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, repeat))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, repeat)
        }
    }
}

// MARK: - View Extensions

fun View.performHaptic(type: HapticType) {
    val manager = HapticFeedbackManager.getInstance(context)
    when (type) {
        HapticType.LIGHT -> manager.lightImpact()
        HapticType.MEDIUM -> manager.mediumImpact()
        HapticType.HEAVY -> manager.heavyImpact()
        HapticType.SELECTION -> manager.selection()
        HapticType.SUCCESS -> manager.success()
        HapticType.WARNING -> manager.warning()
        HapticType.ERROR -> manager.error()
        HapticType.TRANSACTION_COMPLETED -> manager.transactionCompleted()
        HapticType.MONEY_SENT -> manager.moneySent()
        HapticType.MONEY_RECEIVED -> manager.moneyReceived()
        HapticType.BIOMETRIC_SUCCESS -> manager.biometricSuccess()
        HapticType.PULL_TO_REFRESH -> manager.pullToRefresh()
    }
}

enum class HapticType {
    LIGHT, MEDIUM, HEAVY, SELECTION,
    SUCCESS, WARNING, ERROR,
    TRANSACTION_COMPLETED, MONEY_SENT, MONEY_RECEIVED,
    BIOMETRIC_SUCCESS, PULL_TO_REFRESH
}
