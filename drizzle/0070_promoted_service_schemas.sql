-- Promoted from existing service-owned PostgreSQL DDL by .audit/extract_recoverable_service_schema.py.
-- Each statement remains idempotent to support deployed instances where the service created its table before migration adoption.

-- Source: services/python-adverse-media/main.py
CREATE TABLE IF NOT EXISTS adverse_media_results (
                id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
                user_id TEXT NOT NULL,
                full_name TEXT NOT NULL,
                result TEXT NOT NULL,  -- clear, flagged, match
                risk_score NUMERIC NOT NULL DEFAULT 0,
                sources_checked INTEGER NOT NULL DEFAULT 0,
                matches_found INTEGER NOT NULL DEFAULT 0,
                match_details JSONB,
                categories TEXT[],
                screened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
                source TEXT NOT NULL DEFAULT 'complyadvantage'
            );

-- Source: services/python-africbdc-adapter/main.py
CREATE TABLE IF NOT EXISTS africbdc_adapter_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-africbdc-adapter/main.py
CREATE TABLE IF NOT EXISTS africbdc_adapter_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/go-agent-intelligence/main.go
CREATE TABLE IF NOT EXISTS agent_intelligence_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-agent-intelligence/main.go
CREATE TABLE IF NOT EXISTS agent_intelligence_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/python-anomaly-detector/main.py
CREATE TABLE IF NOT EXISTS anomaly_detector_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-anomaly-detector/main.py
CREATE TABLE IF NOT EXISTS anomaly_detector_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/go-bdc-connector/main.go
CREATE TABLE IF NOT EXISTS bdc_transfer_requests (
			id SERIAL PRIMARY KEY,
			reference VARCHAR(100) UNIQUE NOT NULL,
			bdc_partner_id INTEGER NOT NULL,
			corridor_code VARCHAR(20) NOT NULL,
			amount_usd DECIMAL(18,2) NOT NULL,
			amount_ngn DECIMAL(18,2),
			applied_rate DECIMAL(18,6),
			bmatch_rate_snapshot VARCHAR(30),
			beneficiary_account VARCHAR(200) NOT NULL,
			beneficiary_bank VARCHAR(200) NOT NULL,
			beneficiary_name VARCHAR(200) NOT NULL,
			purpose_code VARCHAR(20),
			narration_ref VARCHAR(200),
			adb_reference VARCHAR(200),
			status VARCHAR(30) NOT NULL DEFAULT 'pending',
			message TEXT,
			requested_by VARCHAR(100),
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-bricspay-adapter/main.go
CREATE TABLE IF NOT EXISTS bricspay_adapter_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-bricspay-adapter/main.go
CREATE TABLE IF NOT EXISTS bricspay_adapter_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-cips-adapter/main.go
CREATE TABLE IF NOT EXISTS cips_adapter_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-cips-adapter/main.go
CREATE TABLE IF NOT EXISTS cips_adapter_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/python-compliance-engine/main.py
CREATE TABLE IF NOT EXISTS compliance_engine_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-compliance-engine/main.py
CREATE TABLE IF NOT EXISTS compliance_engine_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-compliance-ml/main.py
CREATE TABLE IF NOT EXISTS compliance_ml_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-compliance-ml/main.py
CREATE TABLE IF NOT EXISTS compliance_ml_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-compliance-service/main.py
CREATE TABLE IF NOT EXISTS compliance_service_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-compliance-service/main.py
CREATE TABLE IF NOT EXISTS compliance_service_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/go-continuous-kyc/main.go
CREATE TABLE IF NOT EXISTS continuous_monitoring (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			monitoring_type TEXT NOT NULL DEFAULT 'sanctions',
			frequency TEXT NOT NULL DEFAULT 'daily',
			status TEXT NOT NULL DEFAULT 'active',
			next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			last_checked_at TIMESTAMPTZ,
			risk_level TEXT NOT NULL DEFAULT 'standard',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-correspondent-manager/main.go
CREATE TABLE IF NOT EXISTS correspondent_manager_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-correspondent-manager/main.go
CREATE TABLE IF NOT EXISTS correspondent_manager_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/python-deepfake-detector/main.py
CREATE TABLE IF NOT EXISTS deepfake_detector_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-deepfake-detector/main.py
CREATE TABLE IF NOT EXISTS deepfake_detector_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: server/_core/platformHardeningV4.ts
CREATE TABLE IF NOT EXISTS document_fraud_checks (
      id SERIAL PRIMARY KEY,
      document_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      issuing_country TEXT NOT NULL,
      is_authentic BOOLEAN NOT NULL,
      confidence_score NUMERIC(4,3) NOT NULL,
      verdict TEXT NOT NULL,
      checks_json JSONB NOT NULL,
      analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

-- Source: services/python-document-fraud/main.py
CREATE TABLE IF NOT EXISTS document_fraud_results (
                    id SERIAL PRIMARY KEY,
                    document_id TEXT NOT NULL,
                    document_type TEXT NOT NULL,
                    issuing_country TEXT NOT NULL,
                    is_authentic BOOLEAN NOT NULL,
                    confidence_score NUMERIC(5,4) NOT NULL,
                    verdict TEXT NOT NULL,
                    font_score NUMERIC(5,4),
                    edge_score NUMERIC(5,4),
                    mrz_score NUMERIC(5,4),
                    microprint_score NUMERIC(5,4),
                    template_score NUMERIC(5,4),
                    anomalies JSONB DEFAULT '[]',
                    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: server/_core/platformHardeningV4.ts
CREATE TABLE IF NOT EXISTS edd_submissions (
      id SERIAL PRIMARY KEY,
      submission_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      source_of_wealth TEXT NOT NULL,
      source_of_funds TEXT NOT NULL,
      employer_name TEXT,
      annual_income NUMERIC,
      income_currency TEXT,
      evidence_document_ids JSONB DEFAULT '[]',
      additional_notes TEXT,
      risk_level TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_review',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    );

-- Source: services/go-export-service/main.go
CREATE TABLE IF NOT EXISTS export_service_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-export-service/main.go
CREATE TABLE IF NOT EXISTS export_service_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-fednow-gateway/main.go
CREATE TABLE IF NOT EXISTS fednow_gateway_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-fednow-gateway/main.go
CREATE TABLE IF NOT EXISTS fednow_gateway_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-fx-aggregator/main.go
CREATE TABLE IF NOT EXISTS fx_aggregator_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-fx-aggregator/main.go
CREATE TABLE IF NOT EXISTS fx_aggregator_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/python-fx-forecasting/main.py
CREATE TABLE IF NOT EXISTS fx_forecasting_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-fx-forecasting/main.py
CREATE TABLE IF NOT EXISTS fx_forecasting_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: server/_core/platformHardeningV4.ts
CREATE TABLE IF NOT EXISTS fx_hedges (
      id SERIAL PRIMARY KEY,
      hedge_id TEXT UNIQUE NOT NULL,
      quote_id TEXT NOT NULL,
      from_currency TEXT NOT NULL,
      to_currency TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      locked_rate NUMERIC NOT NULL,
      lp_order_id TEXT,
      hedged_amount NUMERIC NOT NULL DEFAULT 0,
      spread_cost NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      hedged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

-- Source: services/go-ghipss-adapter/main.go
CREATE TABLE IF NOT EXISTS ghipss_adapter_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-ghipss-adapter/main.go
CREATE TABLE IF NOT EXISTS ghipss_adapter_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/python-gnn-fraud/main.py
CREATE TABLE IF NOT EXISTS gnn_fraud_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-gnn-fraud/main.py
CREATE TABLE IF NOT EXISTS gnn_fraud_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/go-bvn-nin-verification/cmd/server/main.go
CREATE TABLE IF NOT EXISTS go_bvn_nin_verification_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-bvn-nin-verification/cmd/server/main.go
CREATE TABLE IF NOT EXISTS go_bvn_nin_verification_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-goaml-integration/cmd/server/main.go
CREATE TABLE IF NOT EXISTS go_goaml_integration_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-goaml-integration/cmd/server/main.go
CREATE TABLE IF NOT EXISTS go_goaml_integration_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-xof-adapter/main.go
CREATE TABLE IF NOT EXISTS go_xof_adapter_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-xof-adapter/main.go
CREATE TABLE IF NOT EXISTS go_xof_adapter_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-hnw-routing/main.go
CREATE TABLE IF NOT EXISTS hnw_routing_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-hnw-routing/main.go
CREATE TABLE IF NOT EXISTS hnw_routing_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/python-synthetic-identity/main.py
CREATE TABLE IF NOT EXISTS identity_graph_nodes (
                    id SERIAL PRIMARY KEY,
                    node_type TEXT NOT NULL,
                    node_value TEXT NOT NULL,
                    applicant_ids JSONB DEFAULT '[]',
                    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    UNIQUE(node_type, node_value)
                );

-- Source: server/_core/platformHardeningV4.ts
CREATE TABLE IF NOT EXISTS insurance_claims (
      id SERIAL PRIMARY KEY,
      claim_id TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      policy_id TEXT NOT NULL,
      incident_type TEXT NOT NULL,
      incident_date TEXT NOT NULL,
      affected_amount NUMERIC NOT NULL,
      affected_currency TEXT NOT NULL,
      description TEXT,
      evidence_urls JSONB DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'submitted',
      nexus_claim_id TEXT,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

-- Source: services/python-kyc-liveness/main.py
CREATE TABLE IF NOT EXISTS kyc_liveness_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-kyc-liveness/main.py
CREATE TABLE IF NOT EXISTS kyc_liveness_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: server/middleware/eventSourcing.ts
CREATE TABLE IF NOT EXISTS materialized_projections (
    projection_id VARCHAR(200) PRIMARY KEY,
    last_event_id UUID,
    last_version INTEGER NOT NULL DEFAULT 0,
    state JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

-- Source: services/python-ml-retraining/main.py
CREATE TABLE IF NOT EXISTS ml_retraining_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-ml-retraining/main.py
CREATE TABLE IF NOT EXISTS ml_retraining_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-mlflow-registry/main.py
CREATE TABLE IF NOT EXISTS mlflow_registry_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-mlflow-registry/main.py
CREATE TABLE IF NOT EXISTS mlflow_registry_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: server/_core/platformHardeningV4.ts
CREATE TABLE IF NOT EXISTS onchain_transfers (
      id SERIAL PRIMARY KEY,
      tx_hash TEXT UNIQUE NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      token_address TEXT,
      chain TEXT NOT NULL,
      status TEXT NOT NULL,
      gas_used TEXT,
      block_number BIGINT,
      user_id TEXT NOT NULL,
      explorer_url TEXT,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

-- Source: services/outbound-swift/main.go
CREATE TABLE IF NOT EXISTS outbound_swift_state (
		id TEXT PRIMARY KEY,
		data JSONB DEFAULT '{}'::jsonb,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

-- Source: services/go-p2p-sanctions/main.go
CREATE TABLE IF NOT EXISTS p2p_sanctions_state (
		id TEXT PRIMARY KEY,
		data JSONB DEFAULT '{}'::jsonb,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

-- Source: services/go-papss-service/main.go
CREATE TABLE IF NOT EXISTS papss_service_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-papss-service/main.go
CREATE TABLE IF NOT EXISTS papss_service_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/python-pboc-compliance/main.py
CREATE TABLE IF NOT EXISTS pboc_compliance_filings (
                        id TEXT PRIMARY KEY,
                        filing_type TEXT NOT NULL,
                        transaction_ref TEXT,
                        amount NUMERIC,
                        currency TEXT DEFAULT 'CNY',
                        risk_level TEXT DEFAULT 'LOW',
                        status TEXT DEFAULT 'filed',
                        details JSONB DEFAULT '{}',
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    );

-- Source: services/rust-platform-hardening/src/main.rs
CREATE TABLE IF NOT EXISTS platform_hardening_state (id TEXT PRIMARY KEY, data JSONB DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ DEFAULT NOW());

-- Source: services/rust-pq-crypto/src/main.rs
CREATE TABLE IF NOT EXISTS pq_crypto_state (
                    id TEXT PRIMARY KEY,
                    data JSONB DEFAULT '{}'::jsonb,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );

-- Source: services/python-property-risk/main.py
CREATE TABLE IF NOT EXISTS property_risk_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-property-risk/main.py
CREATE TABLE IF NOT EXISTS property_risk_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-cbn-lakehouse/main.py
CREATE TABLE IF NOT EXISTS python_cbn_lakehouse_events (
                        id BIGSERIAL PRIMARY KEY,
                        event_type TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

-- Source: services/python-cbn-lakehouse/main.py
CREATE TABLE IF NOT EXISTS python_cbn_lakehouse_state (
                        id TEXT PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

-- Source: services/python-keycloak-service/app/main.py
CREATE TABLE IF NOT EXISTS python_keycloak_service_events (
                        id BIGSERIAL PRIMARY KEY,
                        event_type TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

-- Source: services/python-pix-adapter/app/main.py
CREATE TABLE IF NOT EXISTS python_pix_adapter_events (
                        id BIGSERIAL PRIMARY KEY,
                        event_type TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );

-- Source: services/go-multi-rail-failover/main.go
CREATE TABLE IF NOT EXISTS rail_failover_decisions (
		id SERIAL PRIMARY KEY,
		corridor TEXT NOT NULL,
		amount NUMERIC NOT NULL,
		currency TEXT NOT NULL,
		selected_rail TEXT NOT NULL,
		fallback_rails JSONB NOT NULL DEFAULT '[]',
		reason TEXT,
		health_scores JSONB NOT NULL DEFAULT '{}',
		decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

-- Source: services/go-multi-rail-failover/main.go
CREATE TABLE IF NOT EXISTS rail_health_checks (
		id SERIAL PRIMARY KEY,
		rail_id TEXT NOT NULL REFERENCES rail_registry(id),
		is_healthy BOOLEAN NOT NULL,
		latency_ms BIGINT NOT NULL DEFAULT 0,
		error_message TEXT,
		checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

-- Source: services/go-multi-rail-failover/main.go
CREATE TABLE IF NOT EXISTS rail_registry (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		corridors JSONB NOT NULL DEFAULT '[]',
		max_amount NUMERIC NOT NULL DEFAULT 1000000,
		min_amount NUMERIC NOT NULL DEFAULT 0.01,
		is_active BOOLEAN NOT NULL DEFAULT true,
		created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
	);

-- Source: services/python-tigerbeetle-reconciliation/main.py
CREATE TABLE IF NOT EXISTS reconciliation_runs (
                    id BIGSERIAL PRIMARY KEY,
                    run_id TEXT NOT NULL UNIQUE,
                    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at TIMESTAMPTZ,
                    accounts_checked INTEGER NOT NULL DEFAULT 0,
                    discrepancies_found INTEGER NOT NULL DEFAULT 0,
                    auto_resolved INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'running',
                    summary JSONB NOT NULL DEFAULT '{}'
                );

-- Source: services/python-refund-engine/app.py
CREATE TABLE IF NOT EXISTS refund_engine_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-refund-engine/app.py
CREATE TABLE IF NOT EXISTS refund_engine_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/go-regulatory-reports/main.go
CREATE TABLE IF NOT EXISTS regulatory_reports_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-regulatory-reports/main.go
CREATE TABLE IF NOT EXISTS regulatory_reports_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/sanctions-batch-rescreener/src/main.rs
CREATE TABLE IF NOT EXISTS rescreener_history (id TEXT PRIMARY KEY, data JSONB DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ DEFAULT NOW());

-- Source: services/risk-engine/main.go
CREATE TABLE IF NOT EXISTS risk_engine_stats (
		id TEXT PRIMARY KEY,
		data JSONB DEFAULT '{}'::jsonb,
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

-- Source: server/_core/platformHardeningV4.ts
CREATE TABLE IF NOT EXISTS routing_decisions (
      id SERIAL PRIMARY KEY,
      corridor TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      currency TEXT NOT NULL,
      selected_rail TEXT NOT NULL,
      fallback_rails JSONB DEFAULT '[]',
      reason TEXT,
      decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

-- Source: services/go-smart-routing/main.go
CREATE TABLE IF NOT EXISTS routing_rails (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			corridors TEXT[] NOT NULL DEFAULT '{}',
			base_cost_bps NUMERIC NOT NULL DEFAULT 50,
			avg_settlement_ms BIGINT NOT NULL DEFAULT 86400000,
			reliability NUMERIC NOT NULL DEFAULT 0.95,
			max_amount_usd NUMERIC NOT NULL DEFAULT 1000000,
			min_amount_usd NUMERIC NOT NULL DEFAULT 1,
			operating_hours TEXT NOT NULL DEFAULT '24/7',
			is_available BOOLEAN NOT NULL DEFAULT true,
			last_health_check TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			circuit_state TEXT NOT NULL DEFAULT 'closed',
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/python-sanctions-updater/main.py
CREATE TABLE IF NOT EXISTS sanctions_updater_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-sanctions-updater/main.py
CREATE TABLE IF NOT EXISTS sanctions_updater_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/go-security-hardening/main.go
CREATE TABLE IF NOT EXISTS security_hardening_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-security-hardening/main.go
CREATE TABLE IF NOT EXISTS security_hardening_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-security-sidecar/main.go
CREATE TABLE IF NOT EXISTS security_sidecar_events (
			id BIGSERIAL PRIMARY KEY,
			event_type TEXT NOT NULL,
			payload JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: services/go-security-sidecar/main.go
CREATE TABLE IF NOT EXISTS security_sidecar_state (
			id TEXT PRIMARY KEY,
			data JSONB NOT NULL DEFAULT '{}',
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);

-- Source: server/_core/platformHardeningV4.ts
CREATE TABLE IF NOT EXISTS synthetic_identity_checks (
      id SERIAL PRIMARY KEY,
      applicant_id TEXT NOT NULL,
      risk_score NUMERIC(4,3) NOT NULL,
      is_synthetic BOOLEAN NOT NULL DEFAULT false,
      flags JSONB DEFAULT '[]',
      recommendation TEXT NOT NULL,
      analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

-- Source: services/python-synthetic-monitor/app.py
CREATE TABLE IF NOT EXISTS synthetic_monitor_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: services/python-synthetic-monitor/app.py
CREATE TABLE IF NOT EXISTS synthetic_monitor_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );

-- Source: server/_core/platformHardeningV4.ts
CREATE TABLE IF NOT EXISTS transfer_simulations (
      id SERIAL PRIMARY KEY,
      simulation_id TEXT UNIQUE NOT NULL,
      from_user_id TEXT NOT NULL,
      to_user_id TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      currency TEXT NOT NULL,
      target_currency TEXT NOT NULL,
      corridor TEXT NOT NULL,
      rail TEXT,
      would_succeed BOOLEAN NOT NULL,
      steps_json JSONB NOT NULL,
      fees_json JSONB NOT NULL,
      fx_rate NUMERIC NOT NULL,
      recipient_receives NUMERIC NOT NULL,
      simulated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
