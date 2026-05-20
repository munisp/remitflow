package com.example.app.statemanagement

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException

// --- Data Structures ---

/**
 * Represents the unified state of the entire application.
 * This is the single source of truth for the UI.
 * @property isAuthenticated True if the user is logged in.
 * @property userContext Detailed information about the current user.
 * @property isLoading True if a background operation is in progress.
 * @property errorMessage A user-facing message for the last error, or null.
 * @property featureFlags A map of feature names to their enabled status.
 * @property notifications A list of transient messages for the user.
 */
data class AppState(
    val isAuthenticated: Boolean = false,
    val userContext: UserContext = UserContext(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val featureFlags: Map<String, Boolean> = emptyMap(),
    val notifications: List<String> = emptyList()
)

/**
 * Detailed context and profile information for the authenticated user.
 */
data class UserContext(
    val userId: String? = null,
    val username: String? = null,
    val email: String? = null,
    val profilePictureUrl: String? = null,
    val lastLoginTimestamp: Long = 0L
)

/**
 * Utility class for a safe, non-nullable result wrapper for suspend functions.
 * Used for handling API responses with success data or an error exception.
 */
sealed class Result<out T> {
    data class Success<out T>(val data: T) : Result<T>()
    data class Error(val exception: Exception) : Result<Nothing>()
}

/**
 * Sealed class representing all possible actions that can modify the [AppState].
 * This enforces a controlled, predictable state mutation pattern (Redux/Flux-like).
 */
sealed class StateAction {
    data class SetLoading(val isLoading: Boolean) : StateAction()
    data class SetError(val message: String?) : StateAction()
    data class SetAuthentication(val isAuthenticated: Boolean) : StateAction()
    data class UpdateUserContext(val userContext: UserContext) : StateAction()
    data class UpdateFeatureFlags(val flags: Map<String, Boolean>) : StateAction()
    data class AddNotification(val message: String) : StateAction()
    object ClearNotifications : StateAction()
    object Logout : StateAction()
    data class InitializeState(val initialState: AppState) : StateAction()
}

// --- Backend Service Interface and Mock Implementation ---

/**
 * Interface for all backend API interactions related to state management.
 * In a real application, this would be implemented by a Retrofit service or similar.
 */
interface BackendService {
    /** Fetches the initial application state from the server. */
    suspend fun fetchInitialState(): Result<AppState>
    /** Updates the user's profile context on the server. */
    suspend fun updateProfile(context: UserContext): Result<UserContext>
    /** Fetches the latest feature flags. */
    suspend fun fetchFeatureFlags(): Result<Map<String, Boolean>>
    /** Performs a server-side logout. */
    suspend fun logout(): Result<Unit>
}

/**
 * Mock implementation of [BackendService] for development and testing.
 * Simulates network latency and potential errors.
 */
class MockBackendService : BackendService {
    private val initialContext = UserContext(
        userId = "user-123",
        username = "ManusAgent",
        email = "agent@manus.im",
        profilePictureUrl = "https://example.com/avatar.png",
        lastLoginTimestamp = System.currentTimeMillis()
    )

    private val initialFlags = mapOf("new_ui_enabled" to true, "beta_features" to false)

    override suspend fun fetchInitialState(): Result<AppState> {
        kotlinx.coroutines.delay(500) // Simulate network delay
        return Result.Success(
            AppState(
                isAuthenticated = true,
                userContext = initialContext,
                featureFlags = initialFlags
            )
        )
    }

    override suspend fun updateProfile(context: UserContext): Result<UserContext> {
        kotlinx.coroutines.delay(300)
        if (context.username.isNullOrBlank()) {
            return Result.Error(IllegalArgumentException("Username cannot be empty"))
        }
        return Result.Success(context.copy(lastLoginTimestamp = System.currentTimeMillis()))
    }

    override suspend fun fetchFeatureFlags(): Result<Map<String, Boolean>> {
        kotlinx.coroutines.delay(200)
        return Result.Success(initialFlags.mapValues { (_, v) -> !v }) // Simulate a change
    }

    override suspend fun logout(): Result<Unit> {
        kotlinx.coroutines.delay(100)
        return Result.Success(Unit)
    }
}

// --- StateManager Implementation ---

/**
 * A ViewModel-based State Manager for the Android application.
 * It acts as the single source of truth for the application state,
 * managing state mutations via [StateAction]s and handling asynchronous
 * operations like API calls with proper error handling.
 *
 * This class implements the core requirements:
 * 1. ViewModel-based state management.
 * 2. Uses [StateFlow] for unified app state (subscribe).
 * 3. Provides a central [setState] method for state mutation.
 * 4. Provides a [getUserContext] method.
 * 5. Integrates with a [BackendService] for API calls.
 *
 * @param backendService The service responsible for API interactions.
 * @param dispatcher The CoroutineDispatcher for background tasks (defaults to Dispatchers.IO).
 */
class StateManager(
    private val backendService: BackendService = MockBackendService(),
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO
) : ViewModel() {

    // Private mutable state flow, which is updated internally
    private val _state = MutableStateFlow(AppState())

    /**
     * Public immutable [StateFlow] to which UI components can subscribe.
     * This fulfills the 'subscribe' requirement and is the primary way to observe state changes.
     */
    val state: StateFlow<AppState> = _state.asStateFlow()

    init {
        // Automatically initialize the state when the ViewModel is created
        fetchInitialState()
    }

    /**
     * The core state mutation function. All state changes must pass through this function.
     * This fulfills the 'setState' requirement by applying a reducer-like pattern.
     * @param action The [StateAction] to be processed.
     */
    fun setState(action: StateAction) {
        _state.update { currentState ->
            when (action) {
                is StateAction.SetLoading -> currentState.copy(isLoading = action.isLoading, errorMessage = null)
                is StateAction.SetError -> currentState.copy(errorMessage = action.message, isLoading = false)
                is StateAction.SetAuthentication -> currentState.copy(isAuthenticated = action.isAuthenticated)
                is StateAction.UpdateUserContext -> currentState.copy(userContext = action.userContext)
                is StateAction.UpdateFeatureFlags -> currentState.copy(featureFlags = action.flags)
                is StateAction.AddNotification -> currentState.copy(notifications = currentState.notifications + action.message)
                is StateAction.ClearNotifications -> currentState.copy(notifications = emptyList())
                is StateAction.Logout -> AppState(isAuthenticated = false) // Reset to initial state on logout
                is StateAction.InitializeState -> action.initialState.copy(isLoading = false, errorMessage = null)
            }
        }
    }

    /**
     * Convenience method to retrieve the current [UserContext] from the state.
     * This fulfills the 'getUserContext' requirement by providing synchronous access to a subset of the state.
     * @return The current [UserContext].
     */
    fun getUserContext(): UserContext = _state.value.userContext

    // --- Asynchronous Operations and Error Handling (API Integration) ---

    /**
     * Fetches the initial state from the backend and updates the state.
     * Includes comprehensive error handling.
     */
    private fun fetchInitialState() = viewModelScope.launch(dispatcher) {
        setState(StateAction.SetLoading(true))
        when (val result = backendService.fetchInitialState()) {
            is Result.Success -> {
                setState(StateAction.InitializeState(result.data))
            }
            is Result.Error -> {
                handleApiError(result.exception, "Failed to fetch initial state.")
            }
        }
    }

    /**
     * Updates the user's profile context both locally and on the backend.
     * @param newContext The new [UserContext] to save.
     */
    fun updateProfile(newContext: UserContext) = viewModelScope.launch(dispatcher) {
        setState(StateAction.SetLoading(true))
        when (val result = backendService.updateProfile(newContext)) {
            is Result.Success -> {
                setState(StateAction.UpdateUserContext(result.data))
                setState(StateAction.SetLoading(false))
                setState(StateAction.AddNotification("Profile updated successfully."))
            }
            is Result.Error -> {
                handleApiError(result.exception, "Failed to update profile.")
            }
        }
    }

    /**
     * Refreshes the feature flags from the backend.
     */
    fun refreshFeatureFlags() = viewModelScope.launch(dispatcher) {
        setState(StateAction.SetLoading(true))
        when (val result = backendService.fetchFeatureFlags()) {
            is Result.Success -> {
                setState(StateAction.UpdateFeatureFlags(result.data))
                setState(StateAction.SetLoading(false))
            }
            is Result.Error -> {
                handleApiError(result.exception, "Failed to fetch feature flags.")
            }
        }
    }

    /**
     * Handles the user logout process, including API call and state reset.
     */
    fun performLogout() = viewModelScope.launch(dispatcher) {
        setState(StateAction.SetLoading(true))
        when (val result = backendService.logout()) {
            is Result.Success -> {
                setState(StateAction.Logout)
                setState(StateAction.AddNotification("Logged out successfully."))
            }
            is Result.Error -> {
                handleApiError(result.exception, "Logout failed on server, but local state cleared.")
                // Even if API fails, we should clear local state for security
                setState(StateAction.Logout)
            }
        }
    }

    /**
     * Centralized error handling logic.
     * This function translates technical exceptions into user-friendly messages.
     * @param exception The exception that occurred.
     * @param defaultMessage A user-friendly message to display if the exception is generic.
     */
    private fun handleApiError(exception: Exception, defaultMessage: String) {
        val userMessage = when (exception) {
            is IOException -> "Network error: Please check your connection."
            is IllegalArgumentException -> "Input error: ${exception.message}"
            else -> defaultMessage
        }
        // In a production app, this would use a proper logging framework (e.g., Timber)
        println("API Error: ${exception.message}")
        setState(StateAction.SetError(userMessage))
    }

    // --- Factory for ViewModel Instantiation ---

    /**
     * Factory class to instantiate the [StateManager] with dependencies.
     * This is the recommended way to create ViewModels with constructor arguments
     * and ensures proper dependency injection for testing and production.
     */
    class Factory(
        private val backendService: BackendService = MockBackendService(),
        private val dispatcher: CoroutineDispatcher = Dispatchers.IO
    ) : androidx.lifecycle.ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            if (modelClass.isAssignableFrom(StateManager::class.java)) {
                return StateManager(backendService, dispatcher) as T
            }
            throw IllegalArgumentException("Unknown ViewModel class")
        }
    }
}

// --- Example Usage (Documentation) ---

/**
 * Example of how to use the StateManager in an Activity or Fragment.
 * This section is for documentation purposes and is not part of the production class.
 *
 * // In your Activity or Fragment:
 * // private val stateManager: StateManager by viewModels { StateManager.Factory() }
 *
 * // To subscribe to state changes:
 * // lifecycleScope.launch {
 * //     stateManager.state.collect { appState ->
 * //         // Update UI based on appState
 * //         binding.loadingIndicator.isVisible = appState.isLoading
 * //         binding.welcomeText.text = "Welcome, ${appState.userContext.username}"
 * //         appState.errorMessage?.let { showToast(it) }
 * //     }
 * // }
 *
 * // To call setState (indirectly via a function that handles API logic):
 * // binding.updateButton.setOnClickListener {
 * //     val currentContext = stateManager.getUserContext()
 * //     val newContext = currentContext.copy(username = "NewAgentName")
 * //     stateManager.updateProfile(newContext)
 * // }
 *
 * // To get user context synchronously:
 * // val userId = stateManager.getUserContext().userId
 */
