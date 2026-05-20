"""
Avro Schemas for Transaction Events
Schema definitions for all transaction-related Kafka events
"""

# Transaction Created Event Schema
TRANSACTION_CREATED_SCHEMA = {
    "type": "record",
    "name": "TransactionCreated",
    "namespace": "com.nigerian.remittance.events",
    "doc": "Event published when a new transaction is created",
    "fields": [
        {
            "name": "transaction_id",
            "type": "string",
            "doc": "Unique transaction identifier"
        },
        {
            "name": "sender_id",
            "type": "string",
            "doc": "Sender user ID"
        },
        {
            "name": "receiver_id",
            "type": "string",
            "doc": "Receiver user ID"
        },
        {
            "name": "amount",
            "type": "double",
            "doc": "Transaction amount"
        },
        {
            "name": "currency",
            "type": "string",
            "doc": "Currency code (NGN, USD, EUR, etc.)"
        },
        {
            "name": "corridor",
            "type": {
                "type": "enum",
                "name": "PaymentCorridor",
                "symbols": ["PAPSS", "CIPS", "PIX", "UPI", "MOJALOOP"]
            },
            "doc": "Payment corridor used"
        },
        {
            "name": "status",
            "type": {
                "type": "enum",
                "name": "TransactionStatus",
                "symbols": ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"]
            },
            "doc": "Current transaction status"
        },
        {
            "name": "created_at",
            "type": "long",
            "logicalType": "timestamp-millis",
            "doc": "Transaction creation timestamp"
        },
        {
            "name": "metadata",
            "type": ["null", {
                "type": "map",
                "values": "string"
            }],
            "default": null,
            "doc": "Additional transaction metadata"
        }
    ]
}

# Transaction Completed Event Schema
TRANSACTION_COMPLETED_SCHEMA = {
    "type": "record",
    "name": "TransactionCompleted",
    "namespace": "com.nigerian.remittance.events",
    "doc": "Event published when a transaction completes successfully",
    "fields": [
        {
            "name": "transaction_id",
            "type": "string",
            "doc": "Unique transaction identifier"
        },
        {
            "name": "sender_id",
            "type": "string",
            "doc": "Sender user ID"
        },
        {
            "name": "receiver_id",
            "type": "string",
            "doc": "Receiver user ID"
        },
        {
            "name": "amount",
            "type": "double",
            "doc": "Transaction amount"
        },
        {
            "name": "currency",
            "type": "string",
            "doc": "Currency code"
        },
        {
            "name": "corridor",
            "type": "string",
            "doc": "Payment corridor used"
        },
        {
            "name": "completed_at",
            "type": "long",
            "logicalType": "timestamp-millis",
            "doc": "Transaction completion timestamp"
        },
        {
            "name": "processing_time_ms",
            "type": "long",
            "doc": "Time taken to process transaction in milliseconds"
        },
        {
            "name": "fees",
            "type": "double",
            "doc": "Transaction fees charged"
        },
        {
            "name": "exchange_rate",
            "type": ["null", "double"],
            "default": null,
            "doc": "Exchange rate applied (if cross-currency)"
        }
    ]
}

# Transaction Failed Event Schema
TRANSACTION_FAILED_SCHEMA = {
    "type": "record",
    "name": "TransactionFailed",
    "namespace": "com.nigerian.remittance.events",
    "doc": "Event published when a transaction fails",
    "fields": [
        {
            "name": "transaction_id",
            "type": "string",
            "doc": "Unique transaction identifier"
        },
        {
            "name": "sender_id",
            "type": "string",
            "doc": "Sender user ID"
        },
        {
            "name": "receiver_id",
            "type": "string",
            "doc": "Receiver user ID"
        },
        {
            "name": "amount",
            "type": "double",
            "doc": "Transaction amount"
        },
        {
            "name": "currency",
            "type": "string",
            "doc": "Currency code"
        },
        {
            "name": "corridor",
            "type": "string",
            "doc": "Payment corridor attempted"
        },
        {
            "name": "failed_at",
            "type": "long",
            "logicalType": "timestamp-millis",
            "doc": "Failure timestamp"
        },
        {
            "name": "error_code",
            "type": "string",
            "doc": "Error code"
        },
        {
            "name": "error_message",
            "type": "string",
            "doc": "Human-readable error message"
        },
        {
            "name": "retry_count",
            "type": "int",
            "default": 0,
            "doc": "Number of retry attempts"
        },
        {
            "name": "is_retryable",
            "type": "boolean",
            "doc": "Whether the transaction can be retried"
        }
    ]
}

# Fraud Alert Event Schema
FRAUD_ALERT_SCHEMA = {
    "type": "record",
    "name": "FraudAlert",
    "namespace": "com.nigerian.remittance.events",
    "doc": "Event published when fraud is detected",
    "fields": [
        {
            "name": "alert_id",
            "type": "string",
            "doc": "Unique alert identifier"
        },
        {
            "name": "transaction_id",
            "type": "string",
            "doc": "Related transaction ID"
        },
        {
            "name": "user_id",
            "type": "string",
            "doc": "User ID associated with fraud"
        },
        {
            "name": "fraud_score",
            "type": "double",
            "doc": "Fraud probability score (0.0 to 1.0)"
        },
        {
            "name": "risk_level",
            "type": {
                "type": "enum",
                "name": "RiskLevel",
                "symbols": ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
            },
            "doc": "Risk level classification"
        },
        {
            "name": "detected_at",
            "type": "long",
            "logicalType": "timestamp-millis",
            "doc": "Detection timestamp"
        },
        {
            "name": "fraud_indicators",
            "type": {
                "type": "array",
                "items": "string"
            },
            "doc": "List of fraud indicators detected"
        },
        {
            "name": "action_taken",
            "type": {
                "type": "enum",
                "name": "FraudAction",
                "symbols": ["NONE", "FLAGGED", "BLOCKED", "REVIEW_REQUIRED"]
            },
            "doc": "Action taken on the transaction"
        },
        {
            "name": "model_version",
            "type": "string",
            "doc": "Version of fraud detection model used"
        }
    ]
}

# User Created Event Schema
USER_CREATED_SCHEMA = {
    "type": "record",
    "name": "UserCreated",
    "namespace": "com.nigerian.remittance.events",
    "doc": "Event published when a new user is created",
    "fields": [
        {
            "name": "user_id",
            "type": "string",
            "doc": "Unique user identifier"
        },
        {
            "name": "email",
            "type": "string",
            "doc": "User email address"
        },
        {
            "name": "phone",
            "type": ["null", "string"],
            "default": null,
            "doc": "User phone number"
        },
        {
            "name": "country_code",
            "type": "string",
            "doc": "User country code (NG, US, etc.)"
        },
        {
            "name": "kyc_level",
            "type": {
                "type": "enum",
                "name": "KYCLevel",
                "symbols": ["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3"]
            },
            "doc": "KYC verification level"
        },
        {
            "name": "created_at",
            "type": "long",
            "logicalType": "timestamp-millis",
            "doc": "User creation timestamp"
        },
        {
            "name": "referral_code",
            "type": ["null", "string"],
            "default": null,
            "doc": "Referral code used during signup"
        }
    ]
}

# Compliance Event Schema
COMPLIANCE_EVENT_SCHEMA = {
    "type": "record",
    "name": "ComplianceEvent",
    "namespace": "com.nigerian.remittance.events",
    "doc": "Event for compliance-related activities",
    "fields": [
        {
            "name": "event_id",
            "type": "string",
            "doc": "Unique event identifier"
        },
        {
            "name": "event_type",
            "type": {
                "type": "enum",
                "name": "ComplianceEventType",
                "symbols": ["KYC_SUBMITTED", "KYC_APPROVED", "KYC_REJECTED", "AML_CHECK", "SANCTIONS_CHECK"]
            },
            "doc": "Type of compliance event"
        },
        {
            "name": "user_id",
            "type": "string",
            "doc": "User ID"
        },
        {
            "name": "transaction_id",
            "type": ["null", "string"],
            "default": null,
            "doc": "Related transaction ID (if applicable)"
        },
        {
            "name": "occurred_at",
            "type": "long",
            "logicalType": "timestamp-millis",
            "doc": "Event occurrence timestamp"
        },
        {
            "name": "details",
            "type": {
                "type": "map",
                "values": "string"
            },
            "doc": "Event details"
        },
        {
            "name": "result",
            "type": {
                "type": "enum",
                "name": "ComplianceResult",
                "symbols": ["PASSED", "FAILED", "PENDING", "MANUAL_REVIEW"]
            },
            "doc": "Compliance check result"
        }
    ]
}


# Schema registry mapping
SCHEMA_REGISTRY = {
    "transactions.created": TRANSACTION_CREATED_SCHEMA,
    "transactions.completed": TRANSACTION_COMPLETED_SCHEMA,
    "transactions.failed": TRANSACTION_FAILED_SCHEMA,
    "fraud.alerts": FRAUD_ALERT_SCHEMA,
    "users.created": USER_CREATED_SCHEMA,
    "compliance.kyc": COMPLIANCE_EVENT_SCHEMA,
    "compliance.aml": COMPLIANCE_EVENT_SCHEMA,
}


def get_schema(topic_name: str):
    """Get Avro schema for a topic"""
    return SCHEMA_REGISTRY.get(topic_name)

