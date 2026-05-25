"""
RemitFlow — Platform Data Loader

Connects to the real PostgreSQL platform database and extracts feature-engineered
training data for all ML models. Falls back to synthetic data when DB is unavailable.

Supported models:
  - fraud_detection: transactions + user behavior → fraud labels
  - fx_forecasting: fxRateCache → time series per corridor
  - nlu_intent: auditLogs (AI_INTENT_PARSED) → labeled intents
  - investment_scoring: users + wallets + transactions → risk profiles
  - gnn_fraud: transactions graph → node/edge features + fraud labels

Usage:
    loader = PlatformDataLoader(database_url="postgresql://localhost:5432/remitflow")
    X, y, metadata = loader.load_fraud_training_data(lookback_days=180)
"""

import logging
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger("platform-data-loader")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost:5432/remitflow")


class PlatformDataLoader:
    """Loads real platform data from PostgreSQL for ML training."""

    def __init__(self, database_url: Optional[str] = None):
        self.database_url = database_url or DATABASE_URL
        self._conn = None

    def _connect(self):
        if self._conn is not None:
            return self._conn
        try:
            import psycopg2
            self._conn = psycopg2.connect(self.database_url)
            logger.info("Connected to platform database")
            return self._conn
        except Exception as e:
            logger.warning(f"Cannot connect to platform DB: {e}")
            return None

    def _query(self, sql: str, params: tuple = ()) -> Optional[List[Dict]]:
        conn = self._connect()
        if conn is None:
            return None
        try:
            import psycopg2.extras
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                return [dict(row) for row in cur.fetchall()]
        except Exception as e:
            logger.warning(f"Query failed: {e}")
            try:
                conn.rollback()
            except Exception:
                pass
            return None

    def close(self):
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    # ─── Fraud Detection Data ────────────────────────────────────────────────

    def load_fraud_training_data(
        self, lookback_days: int = 180, min_samples: int = 5000
    ) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], Dict[str, Any]]:
        """
        Load transaction data for fraud detection training.

        Features extracted from transactions table:
          - amount (log-scaled)
          - hour_of_day, day_of_week
          - is_international (fromCurrency != toCurrency)
          - sender_velocity_1h, sender_velocity_24h
          - amount_deviation (from sender average)
          - is_new_beneficiary
          - country_risk_score
          - channel_encoded
          - fee_ratio

        Labels: status = 'flagged' or 'rejected' → fraud=1, else 0
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()

        rows = self._query("""
            SELECT
                t.id, t."userId", t.type, t.status,
                t."fromCurrency", COALESCE(CAST(t."fromAmount" AS FLOAT), 0) AS amount,
                t."toCurrency",
                COALESCE(CAST(t.fee AS FLOAT), 0) AS fee,
                t."recipientCountry", t.channel,
                t."createdAt",
                t."recipientName", t."recipientAccount"
            FROM transactions t
            WHERE t."createdAt" >= %s
            ORDER BY t."createdAt" ASC
        """, (cutoff,))

        if rows is None or len(rows) < min_samples:
            logger.info(f"Insufficient platform data ({len(rows) if rows else 0} < {min_samples}), returning None for synthetic fallback")
            return None, None, {"source": "synthetic", "reason": f"only {len(rows) if rows else 0} rows"}

        # Build user velocity lookup
        user_txns: Dict[int, List] = {}
        for r in rows:
            uid = r["userId"]
            if uid not in user_txns:
                user_txns[uid] = []
            user_txns[uid].append(r)

        # Compute user-level stats
        user_avg_amount: Dict[int, float] = {}
        for uid, txns in user_txns.items():
            amounts = [t["amount"] for t in txns]
            user_avg_amount[uid] = float(np.mean(amounts)) if amounts else 0

        HIGH_RISK_COUNTRIES = {"AF", "IR", "KP", "SY", "YE", "SD", "SO", "LY", "IQ", "VE"}
        CHANNEL_MAP = {"web": 0, "mobile": 1, "api": 2, "agent": 3, "pos": 4}

        features = []
        labels = []
        for r in rows:
            uid = r["userId"]
            created = r["createdAt"]
            amount = r["amount"]

            # Time features
            hour = created.hour if hasattr(created, 'hour') else 12
            dow = created.weekday() if hasattr(created, 'weekday') else 0

            # International flag
            is_intl = 1.0 if r["fromCurrency"] != r.get("toCurrency") and r.get("toCurrency") else 0.0

            # Velocity: count user's transactions in last 1h and 24h
            user_hist = user_txns.get(uid, [])
            vel_1h = sum(1 for t in user_hist if t["createdAt"] < created and (created - t["createdAt"]).total_seconds() < 3600)
            vel_24h = sum(1 for t in user_hist if t["createdAt"] < created and (created - t["createdAt"]).total_seconds() < 86400)

            # Amount deviation from user average
            avg = user_avg_amount.get(uid, amount)
            amount_dev = (amount - avg) / max(avg, 1) if avg > 0 else 0

            # Country risk
            country = (r.get("recipientCountry") or "").upper()[:2]
            country_risk = 1.0 if country in HIGH_RISK_COUNTRIES else 0.0

            # Channel
            channel = CHANNEL_MAP.get(r.get("channel", ""), 0)

            # Fee ratio
            fee_ratio = r["fee"] / max(amount, 1)

            # Structuring signal: just below common thresholds
            structuring = 1.0 if 9000 <= amount <= 10000 or 49000 <= amount <= 50000 else 0.0

            feat = [
                np.log1p(amount),       # 0: log_amount
                hour / 24.0,            # 1: hour_normalized
                dow / 7.0,              # 2: day_of_week_normalized
                is_intl,                # 3: is_international
                min(vel_1h, 10) / 10,   # 4: velocity_1h_normalized
                min(vel_24h, 50) / 50,  # 5: velocity_24h_normalized
                np.clip(amount_dev, -3, 3) / 3,  # 6: amount_deviation_normalized
                country_risk,           # 7: country_risk
                channel / 4,            # 8: channel_normalized
                np.clip(fee_ratio, 0, 0.1) / 0.1,  # 9: fee_ratio_normalized
                structuring,            # 10: structuring_signal
            ]
            features.append(feat)

            # Label: flagged/rejected → fraud
            status = (r.get("status") or "").lower()
            is_fraud = 1 if status in ("flagged", "rejected", "fraud", "suspicious") else 0
            labels.append(is_fraud)

        X = np.array(features, dtype=np.float32)
        y = np.array(labels, dtype=np.int64)

        metadata = {
            "source": "platform_db",
            "total_samples": len(X),
            "fraud_rate": float(y.mean()),
            "lookback_days": lookback_days,
            "unique_users": len(user_txns),
            "features": ["log_amount", "hour", "dow", "is_international", "velocity_1h", "velocity_24h",
                         "amount_deviation", "country_risk", "channel", "fee_ratio", "structuring_signal"],
            "loaded_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(f"Loaded {len(X)} fraud training samples from platform DB (fraud_rate={metadata['fraud_rate']:.4f})")
        return X, y, metadata

    # ─── FX Rate Data ────────────────────────────────────────────────────────

    def load_fx_training_data(
        self, corridor: str = "USD-NGN", min_days: int = 100
    ) -> Tuple[Optional[np.ndarray], Dict[str, Any]]:
        """
        Load historical FX rates from fxRateCache table.
        Returns (n_days, 5) array: [close, high, low, volume_proxy, volatility]
        """
        from_ccy, to_ccy = corridor.split("-") if "-" in corridor else (corridor[:3], corridor[3:])

        rows = self._query("""
            SELECT rates, "fetchedAt"
            FROM "fxRateCache"
            WHERE "baseCurrency" = %s
            ORDER BY "fetchedAt" ASC
        """, (from_ccy,))

        if rows is None or len(rows) < min_days:
            return None, {"source": "synthetic", "reason": f"only {len(rows) if rows else 0} rate snapshots"}

        # Extract rate for target currency from JSON rates column
        rates_series = []
        timestamps = []
        for r in rows:
            rate_data = r["rates"]
            if isinstance(rate_data, str):
                import json
                rate_data = json.loads(rate_data)
            if isinstance(rate_data, dict) and to_ccy in rate_data:
                rates_series.append(float(rate_data[to_ccy]))
                timestamps.append(r["fetchedAt"])

        if len(rates_series) < min_days:
            return None, {"source": "synthetic", "reason": f"only {len(rates_series)} {to_ccy} rates found"}

        rates = np.array(rates_series, dtype=np.float64)

        # Compute OHLCV-like features from close prices
        # Group by day to get daily close
        daily_rates = rates  # Each cache entry is roughly one fetch
        close = daily_rates
        high = np.maximum(close, np.roll(close, 1))
        high[0] = close[0]
        low = np.minimum(close, np.roll(close, 1))
        low[0] = close[0]
        volume_proxy = np.abs(np.diff(close, prepend=close[0])) * 1000
        returns = np.diff(np.log(close + 1e-10), prepend=np.log(close[0] + 1e-10))
        volatility = np.zeros_like(close)
        for i in range(5, len(close)):
            volatility[i] = np.std(returns[max(0, i-5):i])

        data = np.column_stack([close, high, low, volume_proxy, volatility]).astype(np.float32)

        metadata = {
            "source": "platform_db",
            "corridor": corridor,
            "n_days": len(data),
            "first_date": str(timestamps[0]),
            "last_date": str(timestamps[-1]),
            "current_rate": float(close[-1]),
            "loaded_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(f"Loaded {len(data)} FX rate snapshots for {corridor} from platform DB")
        return data, metadata

    # ─── NLU Intent Data ─────────────────────────────────────────────────────

    def load_nlu_training_data(
        self, min_samples: int = 500
    ) -> Tuple[Optional[List[Dict]], Dict[str, Any]]:
        """
        Load labeled intent data from audit logs where action = 'AI_INTENT_PARSED'.
        Each log entry contains the raw text and the classified intent.
        """
        rows = self._query("""
            SELECT metadata, "createdAt"
            FROM "auditLogs"
            WHERE action = 'AI_INTENT_PARSED'
            ORDER BY "createdAt" DESC
            LIMIT 50000
        """)

        if rows is None or len(rows) < min_samples:
            return None, {"source": "synthetic", "reason": f"only {len(rows) if rows else 0} intent logs"}

        samples = []
        for r in rows:
            meta = r["metadata"]
            if isinstance(meta, str):
                import json
                meta = json.loads(meta)
            if isinstance(meta, dict) and "intent" in meta:
                raw_text = meta.get("raw", meta.get("message", ""))
                if raw_text:
                    samples.append({
                        "text": raw_text,
                        "intent": meta["intent"],
                        "confidence": meta.get("confidence", 0),
                    })

        if len(samples) < min_samples:
            return None, {"source": "synthetic", "reason": f"only {len(samples)} valid intent samples"}

        # Filter low-confidence predictions to avoid training on bad labels
        high_conf = [s for s in samples if s["confidence"] >= 0.7]
        if len(high_conf) >= min_samples:
            samples = high_conf

        metadata = {
            "source": "platform_db",
            "total_samples": len(samples),
            "high_confidence_samples": len(high_conf) if high_conf else 0,
            "intent_distribution": {},
            "loaded_at": datetime.now(timezone.utc).isoformat(),
        }
        for s in samples:
            intent = s["intent"]
            metadata["intent_distribution"][intent] = metadata["intent_distribution"].get(intent, 0) + 1

        logger.info(f"Loaded {len(samples)} NLU training samples from audit logs")
        return samples, metadata

    # ─── Investment / Risk Scoring Data ───────────────────────────────────────

    def load_investment_training_data(
        self, min_samples: int = 200
    ) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], Dict[str, Any]]:
        """
        Build investor profiles from users + wallets + transactions.

        Features per user:
          - total_balance, num_wallets, num_currencies
          - transaction_count, avg_transaction_amount, total_sent, total_received
          - international_ratio, unique_countries
          - account_age_days, kyc_tier_numeric
          - avg_fee_paid, max_single_transaction
          - transaction_frequency (per week)
          - amount_volatility
        """
        # Get user + wallet summary
        user_rows = self._query("""
            SELECT
                u.id, u."kycTier", u."createdAt" AS user_created,
                COALESCE(SUM(CAST(w.balance AS FLOAT)), 0) AS total_balance,
                COUNT(DISTINCT w.id) AS num_wallets,
                COUNT(DISTINCT w.currency) AS num_currencies
            FROM users u
            LEFT JOIN wallets w ON w."userId" = u.id
            GROUP BY u.id, u."kycTier", u."createdAt"
        """)

        if user_rows is None or len(user_rows) < min_samples:
            return None, None, {"source": "synthetic", "reason": f"only {len(user_rows) if user_rows else 0} users"}

        # Get transaction stats per user
        tx_stats = self._query("""
            SELECT
                "userId",
                COUNT(*) AS tx_count,
                COALESCE(AVG(CAST("fromAmount" AS FLOAT)), 0) AS avg_amount,
                COALESCE(SUM(CAST("fromAmount" AS FLOAT)), 0) AS total_sent,
                COALESCE(MAX(CAST("fromAmount" AS FLOAT)), 0) AS max_amount,
                COALESCE(AVG(CAST(fee AS FLOAT)), 0) AS avg_fee,
                COALESCE(STDDEV(CAST("fromAmount" AS FLOAT)), 0) AS amount_std,
                COUNT(DISTINCT "recipientCountry") AS unique_countries,
                SUM(CASE WHEN "fromCurrency" != "toCurrency" THEN 1 ELSE 0 END) AS intl_count
            FROM transactions
            GROUP BY "userId"
        """)

        tx_map = {}
        if tx_stats:
            for ts in tx_stats:
                tx_map[ts["userId"]] = ts

        KYC_MAP = {"tier0": 0, "tier1": 1, "tier2": 2, "tier3": 3}

        features = []
        for u in user_rows:
            uid = u["id"]
            ts = tx_map.get(uid, {})
            created = u.get("user_created")
            account_age = (datetime.now(timezone.utc) - created).days if created else 0

            tx_count = float(ts.get("tx_count", 0))
            avg_amount = float(ts.get("avg_amount", 0))
            total_sent = float(ts.get("total_sent", 0))
            max_amount = float(ts.get("max_amount", 0))
            avg_fee = float(ts.get("avg_fee", 0))
            amount_std = float(ts.get("amount_std", 0))
            unique_countries = float(ts.get("unique_countries", 0))
            intl_count = float(ts.get("intl_count", 0))
            intl_ratio = intl_count / max(tx_count, 1)
            tx_freq_weekly = tx_count / max(account_age / 7, 1)

            feat = [
                float(u.get("total_balance", 0)),
                float(u.get("num_wallets", 0)),
                float(u.get("num_currencies", 0)),
                tx_count,
                avg_amount,
                total_sent,
                max_amount,
                avg_fee,
                amount_std,
                unique_countries,
                intl_ratio,
                float(account_age),
                float(KYC_MAP.get(u.get("kycTier", "tier0"), 0)),
                tx_freq_weekly,
                float(u.get("total_balance", 0)) / max(total_sent / max(tx_count, 1), 1),
            ]
            features.append(feat)

        X = np.array(features, dtype=np.float32)

        # Generate risk labels from feature patterns
        # Conservative: low balance/tx, Aggressive: high balance/tx + international
        risk_scores = (
            0.3 * (X[:, 0] / max(X[:, 0].max(), 1)) +        # balance
            0.2 * (X[:, 3] / max(X[:, 3].max(), 1)) +        # tx_count
            0.2 * (X[:, 10]) +                                 # intl_ratio
            0.15 * (X[:, 12] / 3) +                            # kyc_tier
            0.15 * (X[:, 8] / max(X[:, 8].max(), 1))          # amount_std (risk appetite)
        )
        y = np.digitize(risk_scores, bins=[0.25, 0.5, 0.75]).astype(np.int64)

        metadata = {
            "source": "platform_db",
            "total_users": len(X),
            "features": ["total_balance", "num_wallets", "num_currencies", "tx_count", "avg_amount",
                         "total_sent", "max_amount", "avg_fee", "amount_std", "unique_countries",
                         "intl_ratio", "account_age_days", "kyc_tier", "tx_freq_weekly", "balance_per_avg_tx"],
            "risk_distribution": {str(k): int(v) for k, v in zip(*np.unique(y, return_counts=True))},
            "loaded_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(f"Loaded {len(X)} investor profiles from platform DB")
        return X, y, metadata

    # ─── GNN Graph Data ──────────────────────────────────────────────────────

    def load_gnn_graph_data(
        self, lookback_days: int = 90, min_transactions: int = 1000
    ) -> Tuple[Optional[Dict], Dict[str, Any]]:
        """
        Build transaction graph from platform DB.
        Returns graph dict with node_features, edge_index, labels.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()

        rows = self._query("""
            SELECT
                t.id, t."userId",
                COALESCE(CAST(t."fromAmount" AS FLOAT), 0) AS amount,
                t.status, t."recipientAccount", t."recipientCountry",
                t."fromCurrency", t."toCurrency", t.channel,
                t."createdAt"
            FROM transactions t
            WHERE t."createdAt" >= %s
            ORDER BY t."createdAt" ASC
        """, (cutoff,))

        if rows is None or len(rows) < min_transactions:
            return None, {"source": "synthetic", "reason": f"only {len(rows) if rows else 0} transactions"}

        # Build bipartite graph: users ↔ transactions
        user_ids = sorted(set(r["userId"] for r in rows))
        user_to_idx = {uid: i for i, uid in enumerate(user_ids)}
        n_users = len(user_ids)

        # Node features for users
        user_features = {}
        for r in rows:
            uid = r["userId"]
            if uid not in user_features:
                user_features[uid] = {"amounts": [], "countries": set(), "channels": set()}
            user_features[uid]["amounts"].append(r["amount"])
            if r.get("recipientCountry"):
                user_features[uid]["countries"].add(r["recipientCountry"])
            if r.get("channel"):
                user_features[uid]["channels"].add(r["channel"])

        # Build feature vectors
        node_features = []  # Users first, then transactions
        for uid in user_ids:
            uf = user_features[uid]
            amounts = uf["amounts"]
            feat = [
                len(amounts),                           # tx_count
                float(np.mean(amounts)),                # avg_amount
                float(np.std(amounts)) if len(amounts) > 1 else 0,  # amount_std
                float(np.max(amounts)),                 # max_amount
                len(uf["countries"]),                    # unique_countries
                len(uf["channels"]),                     # unique_channels
                0.0,                                    # placeholder
                0.0,                                    # placeholder
            ]
            node_features.append(feat)

        tx_indices = {}
        for i, r in enumerate(rows):
            tx_idx = n_users + i
            tx_indices[r["id"]] = tx_idx

            is_intl = 1.0 if r["fromCurrency"] != r.get("toCurrency") and r.get("toCurrency") else 0.0
            hour = r["createdAt"].hour if hasattr(r["createdAt"], 'hour') else 12

            feat = [
                np.log1p(r["amount"]),
                hour / 24.0,
                is_intl,
                r["amount"] / 10000,
                0.0, 0.0, 0.0, 0.0,
            ]
            node_features.append(feat)

        # Edge index: user→tx and tx→receiver_user
        src_edges = []
        dst_edges = []
        for r in rows:
            user_idx = user_to_idx[r["userId"]]
            tx_idx = tx_indices[r["id"]]
            src_edges.extend([user_idx, tx_idx])
            dst_edges.extend([tx_idx, user_idx])

        # Labels: transaction nodes labeled by status
        n_total = n_users + len(rows)
        labels = np.zeros(n_total, dtype=np.int64)
        for r in rows:
            tx_idx = tx_indices[r["id"]]
            status = (r.get("status") or "").lower()
            if status in ("flagged", "rejected", "fraud", "suspicious"):
                labels[tx_idx] = 1

        graph = {
            "node_features": np.array(node_features, dtype=np.float32),
            "edge_index": np.array([src_edges, dst_edges], dtype=np.int64),
            "labels": labels,
            "n_users": n_users,
            "n_transactions": len(rows),
        }

        metadata = {
            "source": "platform_db",
            "n_users": n_users,
            "n_transactions": len(rows),
            "n_nodes": n_total,
            "n_edges": len(src_edges),
            "fraud_rate": float(labels.mean()),
            "lookback_days": lookback_days,
            "loaded_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(f"Built GNN graph: {n_total} nodes, {len(src_edges)} edges, fraud_rate={metadata['fraud_rate']:.4f}")
        return graph, metadata

    # ─── Prediction Feedback Store ───────────────────────────────────────────

    def store_prediction(self, model_name: str, input_id: str, prediction: float,
                         actual: Optional[float] = None, metadata: Optional[Dict] = None):
        """Store a prediction for feedback loop training."""
        conn = self._connect()
        if conn is None:
            return False
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO ml_predictions (model_name, input_id, prediction, actual, metadata, created_at)
                    VALUES (%s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (model_name, input_id) DO UPDATE SET
                        actual = EXCLUDED.actual,
                        metadata = EXCLUDED.metadata
                """, (model_name, input_id, prediction, actual,
                      json.dumps(metadata) if metadata else None))
                conn.commit()
            return True
        except Exception as e:
            logger.warning(f"Failed to store prediction: {e}")
            try:
                conn.rollback()
            except Exception:
                pass
            return False

    def load_feedback_data(self, model_name: str, min_samples: int = 100
                          ) -> Tuple[Optional[List[Dict]], Dict[str, Any]]:
        """Load predictions that have received actual outcomes (feedback loop)."""
        rows = self._query("""
            SELECT input_id, prediction, actual, metadata, created_at
            FROM ml_predictions
            WHERE model_name = %s AND actual IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 50000
        """, (model_name,))

        if rows is None or len(rows) < min_samples:
            return None, {"source": "no_feedback", "samples": len(rows) if rows else 0}

        metadata = {
            "source": "feedback_loop",
            "total_samples": len(rows),
            "model_name": model_name,
            "accuracy": float(np.mean([
                1 if (r["prediction"] > 0.5) == (r["actual"] > 0.5) else 0
                for r in rows
            ])),
        }
        return rows, metadata


# ─── Convenience import ──────────────────────────────────────────────────────

import json

def get_loader(database_url: Optional[str] = None) -> PlatformDataLoader:
    return PlatformDataLoader(database_url)
