package com.example.app.transaction

import com.example.app.api.TransactionApi
import com.example.app.api.TransactionRequest
import com.example.app.api.TransactionResponse
import com.example.app.data.TransactionResult
import com.example.app.data.TransactionStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.mockito.Mock
import org.mockito.Mockito.*
import org.mockito.junit.MockitoJUnit
import org.mockito.junit.MockitoRule
import retrofit2.Response
import java.io.IOException

// Inferred class structure for TransactionFlowManager
// data class TransactionParams(val amount: Double, val recipientId: String, val currency: String)
// interface TransactionApi {
//     suspend fun submitTransaction(request: TransactionRequest): Response<TransactionResponse>
// }
// data class TransactionRequest(val amount: Double, val recipientId: String, val currency: String)
// data class TransactionResponse(val transactionId: String, val status: String, val message: String?)
// data class TransactionResult(val status: TransactionStatus, val transactionId: String?, val errorMessage: String?)
// enum class TransactionStatus { SUCCESS, FAILURE, PENDING }

@ExperimentalCoroutinesApi
class TransactionFlowManagerTest {

    // Rule to initialize mocks and validate usage
    @get:Rule
    val mockitoRule: MockitoRule = MockitoJUnit.rule()

    // Mock dependencies
    @Mock
    private lateinit var mockTransactionApi: TransactionApi

    // Class under test
    private lateinit var transactionFlowManager: TransactionFlowManager

    // Coroutine testing utilities
    private val testDispatcher = StandardTestDispatcher()
    private val testScope = TestScope(testDispatcher)

    // Sample data
    private val testParams = TransactionFlowManager.TransactionParams(
        amount = 100.0,
        recipientId = "user123",
        currency = "USD"
    )
    private val testRequest = TransactionRequest(
        amount = 100.0,
        recipientId = "user123",
        currency = "USD"
    )
    private val successResponse = TransactionResponse(
        transactionId = "txn456",
        status = "COMPLETED",
        message = "Transaction successful"
    )
    private val apiSuccess = Response.success(successResponse)

    @Before
    fun setup() {
        // Initialize the class under test with the mock API and test dispatcher
        transactionFlowManager = TransactionFlowManager(mockTransactionApi, testDispatcher)
    }

    // --- Success Scenarios ---

    @Test
    fun initiateTransaction_success_returnsCompletedResult() = testScope.runTest {
        // GIVEN: The API call is successful
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenReturn(apiSuccess)

        // WHEN: Initiating the transaction
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The result is a success with the correct transaction ID
        verify(mockTransactionApi).submitTransaction(testRequest)
        assert(result.status == TransactionStatus.SUCCESS)
        assert(result.transactionId == successResponse.transactionId)
        assert(result.errorMessage == null)
    }

    @Test
    fun initiateTransaction_apiReturnsPending_returnsPendingResult() = testScope.runTest {
        // GIVEN: The API call is successful but returns a PENDING status
        val pendingResponse = successResponse.copy(status = "PENDING", transactionId = "txn789")
        val apiPending = Response.success(pendingResponse)
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenReturn(apiPending)

        // WHEN: Initiating the transaction
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The result is PENDING with the correct transaction ID
        verify(mockTransactionApi).submitTransaction(testRequest)
        assert(result.status == TransactionStatus.PENDING)
        assert(result.transactionId == pendingResponse.transactionId)
        assert(result.errorMessage == null)
    }

    // --- API Error Scenarios (HTTP Errors) ---

    @Test
    fun initiateTransaction_http400_returnsFailureResult() = testScope.runTest {
        // GIVEN: The API returns a 400 Bad Request error
        val errorBody = "{\"error\": \"Invalid amount\"}"
        val apiError = Response.error<TransactionResponse>(
            400,
            retrofit2.ResponseBody.create(
                okhttp3.MediaType.parse("application/json"),
                errorBody
            )
        )
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenReturn(apiError)

        // WHEN: Initiating the transaction
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The result is a failure with a descriptive error message
        verify(mockTransactionApi).submitTransaction(testRequest)
        assert(result.status == TransactionStatus.FAILURE)
        assert(result.transactionId == null)
        assert(result.errorMessage!!.contains("HTTP 400"))
        assert(result.errorMessage!!.contains("Invalid amount"))
    }

    @Test
    fun initiateTransaction_http500_returnsFailureResult() = testScope.runTest {
        // GIVEN: The API returns a 500 Internal Server Error
        val apiError = Response.error<TransactionResponse>(
            500,
            retrofit2.ResponseBody.create(
                okhttp3.MediaType.parse("application/json"),
                "Server error"
            )
        )
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenReturn(apiError)

        // WHEN: Initiating the transaction
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The result is a failure with a descriptive error message
        verify(mockTransactionApi).submitTransaction(testRequest)
        assert(result.status == TransactionStatus.FAILURE)
        assert(result.transactionId == null)
        assert(result.errorMessage!!.contains("HTTP 500"))
    }

    // --- API Error Scenarios (Business Logic Errors in Response Body) ---

    @Test
    fun initiateTransaction_apiReturnsFailedStatus_returnsFailureResult() = testScope.runTest {
        // GIVEN: The API call is successful (HTTP 200) but the response body indicates a business failure
        val failedResponse = successResponse.copy(
            transactionId = "txn999",
            status = "FAILED",
            message = "Insufficient funds"
        )
        val apiFailed = Response.success(failedResponse)
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenReturn(apiFailed)

        // WHEN: Initiating the transaction
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The result is a failure with the specific error message
        verify(mockTransactionApi).submitTransaction(testRequest)
        assert(result.status == TransactionStatus.FAILURE)
        assert(result.transactionId == failedResponse.transactionId) // ID might still be present
        assert(result.errorMessage == "Insufficient funds")
    }

    // --- Network/System Error Scenarios ---

    @Test
    fun initiateTransaction_networkException_returnsFailureResult() = testScope.runTest {
        // GIVEN: The API call throws an IOException (e.g., network timeout)
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenThrow(IOException("Network failure"))

        // WHEN: Initiating the transaction
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The result is a failure with a network-related error message
        verify(mockTransactionApi).submitTransaction(testRequest)
        assert(result.status == TransactionStatus.FAILURE)
        assert(result.transactionId == null)
        assert(result.errorMessage!!.contains("Network failure"))
    }

    @Test
    fun initiateTransaction_unexpectedException_returnsFailureResult() = testScope.runTest {
        // GIVEN: The API call throws an unexpected RuntimeException
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenThrow(RuntimeException("Unexpected error"))

        // WHEN: Initiating the transaction
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The result is a failure with a generic error message
        verify(mockTransactionApi).submitTransaction(testRequest)
        assert(result.status == TransactionStatus.FAILURE)
        assert(result.transactionId == null)
        assert(result.errorMessage!!.contains("Unexpected error"))
    }

    // --- Edge Case Scenarios ---

    @Test
    fun initiateTransaction_nullResponseBody_returnsFailureResult() = testScope.runTest {
        // GIVEN: The API call is successful (HTTP 200) but the body is null (shouldn't happen with Retrofit but for robustness)
        val apiNullBody = Response.success<TransactionResponse>(null)
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenReturn(apiNullBody)

        // WHEN: Initiating the transaction
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The result is a failure indicating a malformed response
        verify(mockTransactionApi).submitTransaction(testRequest)
        assert(result.status == TransactionStatus.FAILURE)
        assert(result.transactionId == null)
        assert(result.errorMessage!!.contains("Malformed response"))
    }

    @Test
    fun initiateTransaction_emptyErrorBody_returnsGenericHttpFailure() = testScope.runTest {
        // GIVEN: The API returns an HTTP error with an empty error body
        val apiError = Response.error<TransactionResponse>(
            401,
            retrofit2.ResponseBody.create(
                okhttp3.MediaType.parse("application/json"),
                ""
            )
        )
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenReturn(apiError)

        // WHEN: Initiating the transaction
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The result is a failure with a generic HTTP error message
        verify(mockTransactionApi).submitTransaction(testRequest)
        assert(result.status == TransactionStatus.FAILURE)
        assert(result.transactionId == null)
        assert(result.errorMessage!!.contains("HTTP 401"))
        assert(result.errorMessage!!.contains("Empty error body"))
    }

    // --- Coroutine Testing Verification ---

    @Test
    fun initiateTransaction_suspendsUntilCompletion() = testScope.runTest {
        // GIVEN: The API call is successful
        `when`(mockTransactionApi.submitTransaction(testRequest)).thenReturn(apiSuccess)

        // WHEN: Initiating the transaction (runTest ensures it completes before assertions)
        val result = transactionFlowManager.initiateTransaction(testParams)

        // THEN: The transaction is verified to have completed successfully within the test coroutine scope
        assert(result.status == TransactionStatus.SUCCESS)
        verify(mockTransactionApi).submitTransaction(testRequest)
    }
}

// Inferred source code for TransactionFlowManager.kt to ensure 90%+ coverage
// This is included here for completeness and to justify the test cases.
// In a real project, this would be in a separate file.

import javax.inject.Inject
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class TransactionFlowManager @Inject constructor(
    private val transactionApi: TransactionApi,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO // Use Dispatchers.IO in production
) {
    // Inferred data classes and enums
    data class TransactionParams(val amount: Double, val recipientId: String, val currency: String)
    enum class TransactionStatus { SUCCESS, FAILURE, PENDING }
    data class TransactionResult(val status: TransactionStatus, val transactionId: String?, val errorMessage: String?)

    // Inferred API interface and data classes (simplified for internal use)
    interface TransactionApi {
        suspend fun submitTransaction(request: TransactionRequest): Response<TransactionResponse>
    }
    data class TransactionRequest(val amount: Double, val recipientId: String, val currency: String)
    data class TransactionResponse(val transactionId: String, val status: String, val message: String?)

    // Main function to be tested
    suspend fun initiateTransaction(params: TransactionParams): TransactionResult {
        return withContext(ioDispatcher) {
            try {
                val request = TransactionRequest(params.amount, params.recipientId, params.currency)
                val response = transactionApi.submitTransaction(request)

                if (response.isSuccessful) {
                    val body = response.body()
                    if (body != null) {
                        when (body.status) {
                            "COMPLETED" -> TransactionResult(TransactionStatus.SUCCESS, body.transactionId, null)
                            "PENDING" -> TransactionResult(TransactionStatus.PENDING, body.transactionId, null)
                            "FAILED" -> TransactionResult(TransactionStatus.FAILURE, body.transactionId, body.message)
                            else -> TransactionResult(TransactionStatus.FAILURE, body.transactionId, "Unknown status: ${body.status}") // Edge case: unknown status
                        }
                    } else {
                        // Edge case: HTTP 200 but null body
                        TransactionResult(TransactionStatus.FAILURE, null, "Malformed response: HTTP ${response.code()} with null body.")
                    }
                } else {
                    // HTTP error (4xx, 5xx)
                    val errorBodyString = response.errorBody()?.string()
                    val errorMessage = if (errorBodyString.isNullOrEmpty()) {
                        "HTTP ${response.code()} error: Empty error body" // Edge case: empty error body
                    } else {
                        "HTTP ${response.code()} error: $errorBodyString"
                    }
                    TransactionResult(TransactionStatus.FAILURE, null, errorMessage)
                }
            } catch (e: IOException) {
                // Network error
                TransactionResult(TransactionStatus.FAILURE, null, "Network failure: ${e.message}")
            } catch (e: Exception) {
                // Unexpected error
                TransactionResult(TransactionStatus.FAILURE, null, "Unexpected error: ${e.message}")
            }
        }
    }
}

// Dummy Inject and CoroutineDispatcher imports for compilation context
annotation class Inject
interface CoroutineDispatcher
object Dispatchers {
    val IO: CoroutineDispatcher = object : CoroutineDispatcher {}
}