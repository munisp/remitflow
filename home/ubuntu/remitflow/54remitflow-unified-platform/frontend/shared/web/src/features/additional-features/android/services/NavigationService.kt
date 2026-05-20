package com.example.app.navigation

import android.content.Context
import android.os.Bundle
import androidx.annotation.IdRes
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.navigation.NavController
import androidx.navigation.NavOptions
import com.example.app.R
import com.example.app.api.BackendService
import com.example.app.api.KycStatus
import com.example.app.api.TransactionRequest
import com.example.app.api.TransactionResponse
import com.example.app.data.UserRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * # NavigationService
 *
 * A centralized, production-ready service for handling all navigation logic within the application.
 * It encapsulates the Android Navigation Component's [NavController] and integrates with
 * application-specific services like [BackendService] and [UserRepository] to implement
 * complex, conditional navigation flows, such as KYC status checks and transaction processing.
 *
 * This service adheres to modern Android development best practices, utilizing Kotlin Coroutines
 * for asynchronous operations, dependency injection for testability, and a clear separation
 * of concerns.
 *
 * @property navController The primary [NavController] instance for the application's main graph.
 * @property backendService The service for interacting with the remote backend APIs.
 * @property userRepository The repository for accessing local user data and state.
 */
@Singleton
class NavigationService @Inject constructor(
    private val navController: NavController,
    private val backendService: BackendService,
    private val userRepository: UserRepository
) {

    // --- Public API for Navigation Events ---

    /**
     * A [SharedFlow] to broadcast global navigation events, such as a successful transaction
     * or a critical error that requires a full application restart or logout.
     * This can be observed by a central [Activity] or a global state manager.
     */
    private val _globalEvents = MutableSharedFlow<GlobalNavigationEvent>()
    val globalEvents: SharedFlow<GlobalNavigationEvent> = _globalEvents

    /**
     * Navigates the user to the Know Your Customer (KYC) upgrade flow.
     *
     * This method first checks the current KYC status. If the user is already verified,
     * it logs a warning and does nothing. Otherwise, it navigates to the dedicated
     * KYC flow destination.
     *
     * @param sourceDestinationId The ID of the destination that initiated the navigation,
     *                            used for logging and potential deep-linking logic.
     */
    fun navigateToKYCUpgrade(@IdRes sourceDestinationId: Int) {
        Timber.d("Attempting to navigate to KYC upgrade from destination: $sourceDestinationId")
        val currentStatus = userRepository.getKycStatus()

        if (currentStatus == KycStatus.VERIFIED) {
            Timber.w("User is already VERIFIED. Aborting KYC upgrade navigation.")
            // Optionally, navigate to a success screen or show a toast
            return
        }

        try {
            val navOptions = NavOptions.Builder()
                .setPopUpTo(R.id.nav_graph_main, false) // Example: clear back stack up to main graph
                .setEnterAnim(R.anim.slide_in_right)
                .setExitAnim(R.anim.slide_out_left)
                .build()

            navController.navigate(R.id.destination_kyc_flow_start, null, navOptions)
            Timber.i("Successfully navigated to KYC flow start.")
        } catch (e: IllegalArgumentException) {
            Timber.e(e, "Navigation failed: KYC destination ID not found in graph.")
            handleNavigationError(NavigationError.DestinationNotFound(R.id.destination_kyc_flow_start))
        } catch (e: Exception) {
            Timber.e(e, "An unexpected error occurred during KYC navigation.")
            handleNavigationError(NavigationError.Unknown(e.message ?: "Unknown error"))
        }
    }

    /**
     * Initiates a transaction flow, which involves a backend API call and conditional navigation.
     *
     * This is a complex flow that demonstrates API integration and error handling.
     * It requires a [LifecycleOwner] to launch a coroutine for the asynchronous API call.
     *
     * @param lifecycleOwner The [LifecycleOwner] (e.g., a Fragment) to scope the coroutine.
     * @param request The [TransactionRequest] containing details like amount and recipient.
     * @return A [Job] representing the coroutine execution.
     */
    fun navigateToTransaction(
        lifecycleOwner: LifecycleOwner,
        request: TransactionRequest
    ): Job = lifecycleOwner.lifecycleScope.launch {
        Timber.i("Starting transaction flow for request: ${request.transactionId}")

        // 1. Pre-check: Ensure user is verified for transactions
        if (userRepository.getKycStatus() != KycStatus.VERIFIED) {
            Timber.w("Transaction aborted: User is not verified.")
            _globalEvents.emit(GlobalNavigationEvent.ShowToast("Please complete KYC verification first."))
            navigateToKYCUpgrade(navController.currentDestination?.id ?: R.id.destination_home)
            return@launch
        }

        // 2. API Call and Error Handling
        val result: Result<TransactionResponse> = withContext(Dispatchers.IO) {
            try {
                val response = backendService.executeTransaction(request)
                Result.success(response)
            } catch (e: Exception) {
                Timber.e(e, "Transaction API call failed for ID: ${request.transactionId}")
                Result.failure(e)
            }
        }

        // 3. Post-API Conditional Navigation
        result.fold(
            onSuccess = { response ->
                Timber.i("Transaction successful. Response: ${response.status}")
                val bundle = Bundle().apply {
                    putString("transactionId", response.transactionId)
                    putString("status", response.status.name)
                }
                navController.navigate(R.id.destination_transaction_success, bundle)
                _globalEvents.emit(GlobalNavigationEvent.TransactionCompleted(response.transactionId))
            },
            onFailure = { error ->
                Timber.e("Transaction failed with error: ${error.message}")
                val errorMessage = when (error) {
                    is java.net.UnknownHostException -> "Network error. Check your connection."
                    is java.util.concurrent.TimeoutException -> "Request timed out. Try again."
                    else -> "Transaction failed: ${error.message}"
                }
                val bundle = Bundle().apply { putString("errorMessage", errorMessage) }
                navController.navigate(R.id.destination_transaction_failure, bundle)
                handleNavigationError(NavigationError.TransactionFailed(errorMessage))
            }
        )
    }

    /**
     * Handles the post-completion logic for the KYC flow.
     *
     * This method is typically called from a deep link or a result listener after the
     * external/internal KYC flow has finished. It updates the local user state and
     * navigates to the appropriate post-KYC destination.
     *
     * @param isSuccessful True if the KYC process was completed successfully.
     * @param context The application context, if needed for resources or external calls.
     */
    fun handleKYCComplete(isSuccessful: Boolean, context: Context) {
        Timber.d("Handling KYC completion. Success: $isSuccessful")

        if (isSuccessful) {
            // Update local state to reflect the new status
            userRepository.updateKycStatus(KycStatus.VERIFIED)
            Timber.i("Local KYC status updated to VERIFIED.")

            // Navigate to a success screen or back to the main dashboard
            val successMessage = context.getString(R.string.kyc_success_message)
            val bundle = Bundle().apply { putString("message", successMessage) }

            // Pop the entire KYC flow stack and navigate to the dashboard
            val navOptions = NavOptions.Builder()
                .setPopUpTo(R.id.destination_kyc_flow_start, true) // Pop the KYC start destination
                .build()

            navController.navigate(R.id.destination_dashboard, bundle, navOptions)
            _globalEvents.emit(GlobalNavigationEvent.ShowToast(successMessage))

        } else {
            // KYC failed or was cancelled
            userRepository.updateKycStatus(KycStatus.PENDING)
            Timber.w("KYC process failed or was cancelled. Status set to PENDING.")

            // Navigate back to a screen that explains the failure
            navController.navigate(R.id.destination_kyc_failure)
            _globalEvents.emit(GlobalNavigationEvent.ShowToast("KYC process incomplete. Please try again."))
        }
    }

    /**
     * Private utility function for centralized error logging and reporting.
     *
     * @param error The [NavigationError] that occurred.
     */
    private fun handleNavigationError(error: NavigationError) {
        Timber.e("NAVIGATION ERROR: ${error.message}")
        // In a real application, this would integrate with a crash reporting tool
        // e.g., Firebase Crashlytics.
        // Crashlytics.logException(RuntimeException("Navigation Error: ${error.message}"))

        // Emit a global event for UI to react (e.g., show a persistent error dialog)
        lifecycleScope.launch {
            _globalEvents.emit(GlobalNavigationEvent.CriticalError(error.message))
        }
    }

    // --- Data Classes and Enums for Type Safety ---

    /**
     * Sealed class representing all possible navigation-related errors.
     * This provides type safety and better error handling.
     */
    sealed class NavigationError(val message: String) {
        class DestinationNotFound(@IdRes val id: Int) : NavigationError("Navigation destination ID $id not found.")
        class TransactionFailed(reason: String) : NavigationError("Transaction failed: $reason")
        class Unknown(reason: String) : NavigationError("An unknown navigation error occurred: $reason")
    }

    /**
     * Sealed class representing global events that the main Activity or a global
     * state manager might need to react to.
     */
    sealed class GlobalNavigationEvent {
        class TransactionCompleted(val transactionId: String) : GlobalNavigationEvent()
        class CriticalError(val message: String) : GlobalNavigationEvent()
        class ShowToast(val message: String) : GlobalNavigationEvent()
        object Logout : GlobalNavigationEvent()
    }

    // --- Mock Dependencies for a Complete Example ---

    /**
     * Mock implementation of a [UserRepository] for demonstration purposes.
     * In a real app, this would be a proper data layer component.
     */
    interface UserRepository {
        fun getKycStatus(): KycStatus
        fun updateKycStatus(status: KycStatus)
    }

    /**
     * Mock implementation of a [BackendService] for demonstration purposes.
     * In a real app, this would be a Retrofit/Ktor client.
     */
    interface BackendService {
        suspend fun executeTransaction(request: TransactionRequest): TransactionResponse
    }

    // --- Mock Data Models (usually in a separate data package) ---

    enum class KycStatus { PENDING, IN_REVIEW, VERIFIED, FAILED }

    data class TransactionRequest(
        val transactionId: String,
        val amount: Double,
        val recipientId: String
    )

    enum class TransactionStatus { SUCCESS, PENDING, FAILED }

    data class TransactionResponse(
        val transactionId: String,
        val status: TransactionStatus,
        val message: String
    )

    // --- Mock Dependency Implementations for DI (usually in a separate module) ---

    @Singleton
    class MockUserRepository @Inject constructor() : UserRepository {
        private var currentStatus: KycStatus = KycStatus.PENDING
        override fun getKycStatus(): KycStatus = currentStatus
        override fun updateKycStatus(status: KycStatus) { currentStatus = status }
    }

    @Singleton
    class MockBackendService @Inject constructor() : BackendService {
        override suspend fun executeTransaction(request: TransactionRequest): TransactionResponse {
            // Simulate network delay
            kotlinx.coroutines.delay(1000)
            // Simulate a successful transaction 90% of the time
            return if (request.amount > 0 && Math.random() > 0.1) {
                TransactionResponse(request.transactionId, TransactionStatus.SUCCESS, "Transaction processed successfully.")
            } else {
                TransactionResponse(request.transactionId, TransactionStatus.FAILED, "Transaction failed due to insufficient funds or internal error.")
            }
        }
    }

    // --- Mock Resources (usually in res/values/strings.xml) ---

    object R {
        object id {
            const val nav_graph_main = 0x7f0a0001 // Mock ID for main nav graph
            const val destination_home = 0x7f0a0002
            const val destination_kyc_flow_start = 0x7f0a0003
            const val destination_transaction_success = 0x7f0a0004
            const val destination_transaction_failure = 0x7f0a0005
            const val destination_dashboard = 0x7f0a0006
            const val destination_kyc_failure = 0x7f0a0007
        }
        object anim {
            const val slide_in_right = 0x7f010001
            const val slide_out_left = 0x7f010002
        }
        object string {
            const val kyc_success_message = "KYC verification complete! You can now perform all transactions."
        }
    }
}

// --- Extension Function for Convenience (usually in a separate file) ---

/**
 * Provides a [LifecycleOwner] scope for services that need to launch coroutines
 * but are not lifecycle-aware themselves. This is a common pattern when a service
 * needs to perform an async task that outlives the caller but should be tied
 * to the application's overall lifecycle (e.g., in a Singleton).
 *
 * NOTE: For a true production app, a dedicated Application-scoped CoroutineScope
 * should be injected instead of relying on a mock [LifecycleOwner].
 */
private val NavigationService.lifecycleScope: kotlinx.coroutines.CoroutineScope
    get() = kotlinx.coroutines.GlobalScope // Using GlobalScope for a Singleton Service's internal error handling

// --- Mock Dagger/Hilt Module for Injection (usually in a separate module) ---

/**
 * Mock Hilt/Dagger module to demonstrate how the dependencies would be provided.
 */
object NavigationModule {
    @Provides
    @Singleton
    fun provideUserRepository(): NavigationService.UserRepository {
        return NavigationService.MockUserRepository()
    }

    @Provides
    @Singleton
    fun provideBackendService(): NavigationService.BackendService {
        return NavigationService.MockBackendService()
    }

    // NOTE: NavController would typically be provided by a Fragment/Activity in a real app
    // or via a custom NavHost setup. For this mock, we assume it's injected.
}