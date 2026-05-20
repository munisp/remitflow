package com.example.app.navigation

import androidx.core.os.bundleOf
import androidx.navigation.NavController
import com.example.app.R
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mock
import org.mockito.Mockito.verify
import org.mockito.MockitoAnnotations
import org.mockito.junit.MockitoJUnitRunner

/**
 * Unit tests for the [NavigationService] class using JUnit and Mockito.
 * Aims for 90%+ code coverage by testing all navigation methods and their branches.
 */
@RunWith(MockitoJUnitRunner::class)
class NavigationServiceTest {

    // Mock the NavController, which is the external dependency
    @Mock
    private lateinit var mockNavController: NavController

    // The class under test
    private lateinit var navigationService: NavigationService

    /**
     * Setup method to initialize mocks and the class under test before each test.
     */
    @Before
    fun setup() {
        // Initialize mocks annotated with @Mock
        MockitoAnnotations.openMocks(this)
        // Instantiate the service with the mocked dependency
        navigationService = NavigationService(mockNavController)
    }

    // --- Test navigateToKYCUpgrade ---

    @Test
    fun testNavigateToKYCUpgrade_navigatesToCorrectDestination() {
        // When
        navigationService.navigateToKYCUpgrade()

        // Then: Verify that navController.navigate was called with the correct destination ID
        verify(mockNavController).navigate(R.id.kyc_upgrade_destination)
    }

    // --- Test navigateToTransaction ---

    @Test
    fun testNavigateToTransaction_withValidId_navigatesWithCorrectBundle() {
        // Given
        val transactionId = "TXN-12345"
        val expectedBundle = bundleOf("transaction_id" to transactionId)

        // When
        navigationService.navigateToTransaction(transactionId)

        // Then: Verify that navController.navigate was called with the correct destination ID and bundle
        verify(mockNavController).navigate(R.id.transaction_detail_destination, expectedBundle)
    }

    @Test
    fun testNavigateToTransaction_withEmptyId_navigatesWithEmptyBundleValue() {
        // Given
        val transactionId = ""
        val expectedBundle = bundleOf("transaction_id" to transactionId)

        // When
        navigationService.navigateToTransaction(transactionId)

        // Then: Verify that navController.navigate was called, handling the edge case of an empty ID
        verify(mockNavController).navigate(R.id.transaction_detail_destination, expectedBundle)
    }

    // --- Test handleKYCComplete ---

    @Test
    fun testHandleKYCComplete_whenSuccessIsTrue_navigatesToSuccessDestination() {
        // When
        navigationService.handleKYCComplete(true)

        // Then: Verify navigation to the success screen
        verify(mockNavController).navigate(R.id.kyc_success_destination)
    }

    @Test
    fun testHandleKYCComplete_whenSuccessIsFalse_navigatesToFailureDestination() {
        // When
        navigationService.handleKYCComplete(false)

        // Then: Verify navigation to the failure screen (error scenario)
        verify(mockNavController).navigate(R.id.kyc_failure_destination)
    }

    // --- Test Navigation Component (General Navigation) ---

    @Test
    fun testNavigateToHome_performsSimpleNavigation() {
        // When
        navigationService.navigateToHome()

        // Then: Verify navigation to the home screen
        verify(mockNavController).navigate(R.id.home_destination)
    }

    // --- Edge Case Testing (Inferred navigateToSettings) ---

    @Test
    fun testNavigateToSettings_whenLoggedIn_navigatesToSettingsDestination() {
        // When
        navigationService.navigateToSettings(true)

        // Then: Verify navigation to the settings screen
        verify(mockNavController).navigate(R.id.settings_destination)
    }

    @Test
    fun testNavigateToSettings_whenNotLoggedIn_navigatesToLoginDestination() {
        // When
        navigationService.navigateToSettings(false)

        // Then: Verify navigation to the login screen (guarded navigation edge case)
        verify(mockNavController).navigate(R.id.login_destination)
    }
}