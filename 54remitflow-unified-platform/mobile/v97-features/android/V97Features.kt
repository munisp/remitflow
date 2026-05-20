package com.remitflow.mobile.v97

import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import retrofit2.http.*

// ─── V97 API Models ───────────────────────────────────────────────────────────

data class VelocityRule(
    val id: Int,
    val name: String,
    val maxAmount: Double,
    val windowHours: Int,
    val action: String, // "block" | "flag" | "review"
    val enabled: Boolean
)

data class KycLifecycleState(
    val userId: Int,
    val currentStage: String,
    val completedAt: Long?,
    val nextAction: String?,
    val riskScore: Int
)

data class DocumentRenewal(
    val id: Int,
    val documentType: String,
    val expiresAt: Long,
    val status: String, // "pending" | "completed" | "overdue"
    val daysUntilExpiry: Int
)

data class WebhookDelivery(
    val id: Int,
    val endpointUrl: String,
    val eventType: String,
    val status: String,
    val attempts: Int,
    val lastAttemptAt: Long?,
    val nextRetryAt: Long?
)

data class ApiKeyInfo(
    val id: Int,
    val name: String,
    val prefix: String,
    val scopes: List<String>,
    val lastUsedAt: Long?,
    val expiresAt: Long?,
    val isActive: Boolean
)

data class BatchPaymentSummary(
    val id: Int,
    val name: String,
    val totalItems: Int,
    val successCount: Int,
    val failedCount: Int,
    val pendingCount: Int,
    val status: String,
    val createdAt: Long
)

// ─── V97 API Interface ────────────────────────────────────────────────────────

interface V97ApiService {
    @GET("api/trpc/velocityChecks.list")
    suspend fun getVelocityRules(): List<VelocityRule>

    @GET("api/trpc/kycLifecycle.getMyLifecycle")
    suspend fun getKycLifecycle(): KycLifecycleState

    @GET("api/trpc/documentVaultRenewal.listMyRenewals")
    suspend fun getDocumentRenewals(): List<DocumentRenewal>

    @GET("api/trpc/webhookRetry.getFailedDeliveries")
    suspend fun getFailedWebhooks(): List<WebhookDelivery>

    @POST("api/trpc/webhookRetry.retryDelivery")
    suspend fun retryWebhook(@Body body: Map<String, Int>): Map<String, Any>

    @GET("api/trpc/apiKeyRotation.list")
    suspend fun getApiKeys(): List<ApiKeyInfo>

    @POST("api/trpc/apiKeyRotation.rotate")
    suspend fun rotateApiKey(@Body body: Map<String, Int>): Map<String, String>

    @GET("api/trpc/batchPaymentV97.list")
    suspend fun getBatchPayments(): List<BatchPaymentSummary>

    @POST("api/trpc/batchPaymentV97.retryFailed")
    suspend fun retryFailedBatchItems(@Body body: Map<String, Int>): Map<String, Any>
}

// ─── Velocity Check Screen ────────────────────────────────────────────────────

@Composable
fun VelocityCheckScreen(viewModel: V97ViewModel) {
    val rules by viewModel.velocityRules.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Velocity Rules", style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(8.dp))

        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(rules) { rule ->
                    VelocityRuleCard(rule = rule)
                }
            }
        }
    }
}

@Composable
fun VelocityRuleCard(rule: VelocityRule) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(rule.name, style = MaterialTheme.typography.titleMedium)
                Badge(
                    containerColor = when (rule.action) {
                        "block" -> Color(0xFFEF4444)
                        "flag" -> Color(0xFFF59E0B)
                        else -> Color(0xFF3B82F6)
                    }
                ) {
                    Text(rule.action.uppercase(), color = Color.White)
                }
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text("Max: \$${rule.maxAmount} / ${rule.windowHours}h window",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Status: ${if (rule.enabled) "Active" else "Disabled"}",
                style = MaterialTheme.typography.bodySmall)
        }
    }
}

// ─── KYC Lifecycle Screen ─────────────────────────────────────────────────────

@Composable
fun KycLifecycleScreen(viewModel: V97ViewModel) {
    val lifecycle by viewModel.kycLifecycle.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("KYC Lifecycle", style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(16.dp))

        lifecycle?.let { state ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Current Stage", style = MaterialTheme.typography.labelMedium)
                    Text(state.currentStage.uppercase(),
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.primary)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Risk Score: ${state.riskScore}/100",
                        style = MaterialTheme.typography.bodyMedium)
                    state.nextAction?.let { action ->
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("Next Action: $action",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.secondary)
                    }
                }
            }
        } ?: CircularProgressIndicator()
    }
}

// ─── Document Renewal Screen ──────────────────────────────────────────────────

@Composable
fun DocumentRenewalScreen(viewModel: V97ViewModel) {
    val renewals by viewModel.documentRenewals.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Document Renewals", style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(8.dp))

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(renewals) { renewal ->
                DocumentRenewalCard(renewal = renewal)
            }
        }
    }
}

@Composable
fun DocumentRenewalCard(renewal: DocumentRenewal) {
    val urgencyColor = when {
        renewal.daysUntilExpiry <= 7 -> Color(0xFFEF4444)
        renewal.daysUntilExpiry <= 30 -> Color(0xFFF59E0B)
        else -> Color(0xFF10B981)
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(16.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(renewal.documentType, style = MaterialTheme.typography.titleMedium)
                Text("${renewal.daysUntilExpiry} days until expiry",
                    style = MaterialTheme.typography.bodySmall,
                    color = urgencyColor)
            }
            Badge(containerColor = urgencyColor) {
                Text(renewal.status.uppercase(), color = Color.White)
            }
        }
    }
}

// ─── Webhook Retry Screen ─────────────────────────────────────────────────────

@Composable
fun WebhookRetryScreen(viewModel: V97ViewModel) {
    val deliveries by viewModel.failedWebhooks.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("Failed Webhooks", style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(8.dp))

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(deliveries) { delivery ->
                WebhookDeliveryCard(
                    delivery = delivery,
                    onRetry = { viewModel.retryWebhook(delivery.id) }
                )
            }
        }
    }
}

@Composable
fun WebhookDeliveryCard(delivery: WebhookDelivery, onRetry: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(delivery.eventType, style = MaterialTheme.typography.titleMedium)
            Text(delivery.endpointUrl,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(modifier = Modifier.height(4.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Attempts: ${delivery.attempts}", style = MaterialTheme.typography.bodySmall)
                Button(onClick = onRetry, modifier = Modifier.height(32.dp)) {
                    Text("Retry")
                }
            }
        }
    }
}

// ─── API Key Management Screen ────────────────────────────────────────────────

@Composable
fun ApiKeyManagementScreen(viewModel: V97ViewModel) {
    val apiKeys by viewModel.apiKeys.collectAsState()
    var showRotateDialog by remember { mutableStateOf<Int?>(null) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text("API Keys", style = MaterialTheme.typography.headlineMedium)
        Spacer(modifier = Modifier.height(8.dp))

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(apiKeys) { key ->
                ApiKeyCard(
                    apiKey = key,
                    onRotate = { showRotateDialog = key.id }
                )
            }
        }
    }

    showRotateDialog?.let { keyId ->
        AlertDialog(
            onDismissRequest = { showRotateDialog = null },
            title = { Text("Rotate API Key") },
            text = { Text("This will invalidate the current key and generate a new one. Are you sure?") },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.rotateApiKey(keyId)
                    showRotateDialog = null
                }) { Text("Rotate") }
            },
            dismissButton = {
                TextButton(onClick = { showRotateDialog = null }) { Text("Cancel") }
            }
        )
    }
}

@Composable
fun ApiKeyCard(apiKey: ApiKeyInfo, onRotate: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(apiKey.name, style = MaterialTheme.typography.titleMedium)
                    Text("${apiKey.prefix}••••••••",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                OutlinedButton(onClick = onRotate) {
                    Text("Rotate")
                }
            }
            Spacer(modifier = Modifier.height(4.dp))
            Text("Scopes: ${apiKey.scopes.joinToString(", ")}",
                style = MaterialTheme.typography.bodySmall)
        }
    }
}

// ─── V97 ViewModel ────────────────────────────────────────────────────────────

class V97ViewModel(private val api: V97ApiService) : ViewModel() {
    private val _velocityRules = MutableStateFlow<List<VelocityRule>>(emptyList())
    val velocityRules: StateFlow<List<VelocityRule>> = _velocityRules

    private val _kycLifecycle = MutableStateFlow<KycLifecycleState?>(null)
    val kycLifecycle: StateFlow<KycLifecycleState?> = _kycLifecycle

    private val _documentRenewals = MutableStateFlow<List<DocumentRenewal>>(emptyList())
    val documentRenewals: StateFlow<List<DocumentRenewal>> = _documentRenewals

    private val _failedWebhooks = MutableStateFlow<List<WebhookDelivery>>(emptyList())
    val failedWebhooks: StateFlow<List<WebhookDelivery>> = _failedWebhooks

    private val _apiKeys = MutableStateFlow<List<ApiKeyInfo>>(emptyList())
    val apiKeys: StateFlow<List<ApiKeyInfo>> = _apiKeys

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading

    init {
        loadAll()
    }

    private fun loadAll() {
        viewModelScope.launch {
            _isLoading.value = true
            try {
                _velocityRules.value = api.getVelocityRules()
                _kycLifecycle.value = api.getKycLifecycle()
                _documentRenewals.value = api.getDocumentRenewals()
                _failedWebhooks.value = api.getFailedWebhooks()
                _apiKeys.value = api.getApiKeys()
            } catch (e: Exception) {
                // Handle error
            } finally {
                _isLoading.value = false
            }
        }
    }

    fun retryWebhook(deliveryId: Int) {
        viewModelScope.launch {
            try {
                api.retryWebhook(mapOf("deliveryId" to deliveryId))
                _failedWebhooks.value = api.getFailedWebhooks()
            } catch (e: Exception) { /* handle */ }
        }
    }

    fun rotateApiKey(keyId: Int) {
        viewModelScope.launch {
            try {
                api.rotateApiKey(mapOf("keyId" to keyId))
                _apiKeys.value = api.getApiKeys()
            } catch (e: Exception) { /* handle */ }
        }
    }
}
