package com.example.app.state

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.Description
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.MockitoAnnotations
import kotlin.coroutines.ContinuationInterceptor

// Custom Test Rule to manage the Main Coroutine Dispatcher
@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule(
    val testDispatcher: TestDispatcher = UnconfinedTestDispatcher(),
) : TestWatcher() {
    override fun starting(description: Description) {
        Dispatchers.setMain(testDispatcher)
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class StateManagerTest {

    // Rule for LiveData/ViewModel testing
    @get:Rule
    val instantTaskExecutorRule = InstantTaskExecutorRule()

    // Rule for Coroutines testing
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    @Mock
    private lateinit var mockApiService: ApiService

    private lateinit var stateManager: StateManager
    private lateinit var viewModel: MainViewModel

    private val testUserId = "user123"
    private val testUsername = "TestUser"
    private val testData = "Fetched Data"
    private val testException = Exception("API Error")

    @Before
    fun setup() {
        // Initialize mocks
        MockitoAnnotations.openMocks(this)
        // Initialize the StateManager with the mocked dependency
        stateManager = StateManager(mockApiService)
        // Initialize the ViewModel with the StateManager
        viewModel = MainViewModel(stateManager)
    }

    // --- StateManager Tests ---

    @Test
    fun testInitialState_isAnonymousAndNotLoading() = runTest {
        // GIVEN: StateManager is initialized
        // WHEN: We check the initial state
        val initialState = stateManager.state.first()

        // THEN: The state should be the default AppState
        assertTrue("Initial user context should be ANONYMOUS", initialState.userContext is UserContext.ANONYMOUS)
        assertFalse("Initial state should not be loading", initialState.isLoading)
        assertNull("Initial data should be null", initialState.data)
        assertNull("Initial error should be null", initialState.error)
    }

    @Test
    fun testGetUserContext_initialState_returnsAnonymous() {
        // WHEN: Calling getUserContext immediately after setup
        val context = stateManager.getUserContext()

        // THEN: It should return ANONYMOUS
        assertTrue("Context should be ANONYMOUS", context is UserContext.ANONYMOUS)
    }

    @Test
    fun testSetState_updatesStateFlowCorrectly() = runTest {
        // GIVEN: A new state
        val newState = AppState(
            userContext = UserContext.LOGGED_IN(testUserId, testUsername),
            isLoading = true,
            data = "New Data",
            error = "No Error"
        )

        // WHEN: Calling setState
        stateManager.setState(newState)

        // THEN: The state flow should emit the new state
        val emittedState = stateManager.state.first()
        assertEquals("State should be updated", newState, emittedState)
        assertEquals("User context should be updated", newState.userContext, stateManager.getUserContext())
    }

    @Test
    fun testLoginAndFetchData_updatesContextAndLoading() = runTest {
        // GIVEN: The initial state is ANONYMOUS
        val initialContext = stateManager.getUserContext()
        assertTrue(initialContext is UserContext.ANONYMOUS)

        // WHEN: Calling loginAndFetchData
        stateManager.loginAndFetchData(testUserId, testUsername)

        // THEN: The state should be updated to LOGGED_IN and isLoading=true
        val stateAfterLogin = stateManager.state.first()
        assertTrue("User context should be LOGGED_IN", stateAfterLogin.userContext is UserContext.LOGGED_IN)
        assertEquals("User ID should match", testUserId, (stateAfterLogin.userContext as UserContext.LOGGED_IN).userId)
        assertTrue("State should be loading", stateAfterLogin.isLoading)
        assertNull("Error should be cleared", stateAfterLogin.error)
    }

    @Test
    fun testFetchDataForUser_successScenario_updatesState() = runTest {
        // GIVEN: Mock API service returns success
        `when`(mockApiService.fetchUserData(testUserId)).thenReturn(Result.Success(testData))

        // WHEN: Calling fetchDataForUser
        stateManager.fetchDataForUser(testUserId)

        // THEN: State should transition from loading to success
        val finalState = stateManager.state.first()
        assertFalse("State should not be loading", finalState.isLoading)
        assertEquals("Data should be fetched successfully", testData, finalState.data)
        assertNull("Error should be null", finalState.error)

        // VERIFY: API call was made
        verify(mockApiService).fetchUserData(testUserId)
    }

    @Test
    fun testFetchDataForUser_errorScenario_updatesStateWithError() = runTest {
        // GIVEN: Mock API service returns error
        `when`(mockApiService.fetchUserData(testUserId)).thenReturn(Result.Error(testException))

        // WHEN: Calling fetchDataForUser
        stateManager.fetchDataForUser(testUserId)

        // THEN: State should transition from loading to error
        val finalState = stateManager.state.first()
        assertFalse("State should not be loading", finalState.isLoading)
        assertNull("Data should be null", finalState.data)
        assertEquals("Error message should be set", testException.message, finalState.error)

        // VERIFY: API call was made
        verify(mockApiService).fetchUserData(testUserId)
    }

    // --- MainViewModel Tests ---

    @Test
    fun testViewModelInitialState_matchesStateManager() = runTest {
        // GIVEN: StateManager is in initial state
        // WHEN: We check the ViewModel's uiState
        val viewModelInitialState = viewModel.uiState.first()

        // THEN: It should match the StateManager's initial state
        assertEquals("ViewModel state should match StateManager state", stateManager.state.first(), viewModelInitialState)
    }

    @Test
    fun testViewModelLoadData_userNotLoggedIn_setsErrorState() = runTest {
        // GIVEN: StateManager is in ANONYMOUS state (default)
        val initialContext = stateManager.getUserContext()
        assertTrue(initialContext is UserContext.ANONYMOUS)

        // WHEN: Calling loadData on ViewModel
        viewModel.loadData()

        // THEN: StateManager state should be updated with an error
        val finalState = stateManager.state.first()
        assertEquals("Error should be set for anonymous user", "User not logged in", finalState.error)
        assertFalse("Should not be loading", finalState.isLoading)

        // VERIFY: API call was NOT made
        verify(mockApiService, never()).fetchUserData(anyString())
    }

    @Test
    fun testViewModelLoadData_userLoggedIn_triggersFetchData() = runTest {
        // GIVEN: StateManager is set to LOGGED_IN state
        val loggedInContext = UserContext.LOGGED_IN(testUserId, testUsername)
        stateManager.setState(AppState(userContext = loggedInContext))

        // AND: Mock API service returns success
        `when`(mockApiService.fetchUserData(testUserId)).thenReturn(Result.Success(testData))

        // WHEN: Calling loadData on ViewModel
        viewModel.loadData()

        // THEN: StateManager should transition to loading, then to success
        // We need to advance the coroutine to see the final state
        advanceUntilIdle()

        val finalState = stateManager.state.first()
        assertFalse("State should not be loading", finalState.isLoading)
        assertEquals("Data should be fetched successfully", testData, finalState.data)
        assertNull("Error should be null", finalState.error)

        // VERIFY: API call was made with the correct user ID
        verify(mockApiService).fetchUserData(testUserId)
    }

    @Test
    fun testViewModelPerformLogin_updatesStateManagerContext() = runTest {
        // GIVEN: Initial state is ANONYMOUS
        assertTrue(stateManager.getUserContext() is UserContext.ANONYMOUS)

        // WHEN: Calling performLogin on ViewModel
        viewModel.performLogin(testUserId, testUsername)

        // THEN: StateManager state should be updated to LOGGED_IN and loading
        val finalState = stateManager.state.first()
        assertTrue("User context should be LOGGED_IN", finalState.userContext is UserContext.LOGGED_IN)
        assertEquals("User ID should match", testUserId, (finalState.userContext as UserContext.LOGGED_IN).userId)
        assertTrue("State should be loading", finalState.isLoading)
    }

    @Test
    fun testViewModelLoadData_apiError_updatesStateWithError() = runTest {
        // GIVEN: StateManager is set to LOGGED_IN state
        val loggedInContext = UserContext.LOGGED_IN(testUserId, testUsername)
        stateManager.setState(AppState(userContext = loggedInContext))

        // AND: Mock API service returns error
        `when`(mockApiService.fetchUserData(testUserId)).thenReturn(Result.Error(testException))

        // WHEN: Calling loadData on ViewModel
        viewModel.loadData()

        // THEN: StateManager should transition to loading, then to error
        advanceUntilIdle()

        val finalState = stateManager.state.first()
        assertFalse("State should not be loading", finalState.isLoading)
        assertNull("Data should be null", finalState.data)
        assertEquals("Error message should be set", testException.message, finalState.error)

        // VERIFY: API call was made
        verify(mockApiService).fetchUserData(testUserId)
    }

    @Test
    fun testEdgeCase_fetchDataWhileAlreadyLoading_shouldNotInterfere() = runTest {
        // GIVEN: StateManager is set to a loading state with a different user
        val initialData = "Initial Data"
        val initialContext = UserContext.LOGGED_IN("otherUser", "OtherUser")
        stateManager.setState(AppState(userContext = initialContext, isLoading = true, data = initialData))

        // AND: Mock API service returns success for the new user
        `when`(mockApiService.fetchUserData(testUserId)).thenReturn(Result.Success(testData))

        // WHEN: Calling fetchDataForUser for a new user (this simulates a race condition)
        // Note: In a real app, the ViewModel should prevent this, but we test the StateManager directly.
        val job = launch {
            stateManager.fetchDataForUser(testUserId)
        }

        // THEN: The state should update to the new user's data after the call completes
        job.join()

        val finalState = stateManager.state.first()
        assertFalse("State should not be loading", finalState.isLoading)
        assertEquals("Data should be updated to new fetched data", testData, finalState.data)
        assertTrue("User context should remain the initial one", finalState.userContext is UserContext.LOGGED_IN)
        assertEquals("User ID should remain the initial one", "otherUser", (finalState.userContext as UserContext.LOGGED_IN).userId)

        // VERIFY: API call was made
        verify(mockApiService).fetchUserData(testUserId)
    }
}