"""
Liquidity Forecasting Models
Time-series forecasting for bank account liquidity using Prophet and LSTM.
"""

import os
import json
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from enum import Enum

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error
import joblib

import asyncpg
import redis.asyncio as redis

# Prophet for time-series forecasting
try:
    from prophet import Prophet
    PROPHET_AVAILABLE = True
except ImportError:
    PROPHET_AVAILABLE = False

# PyTorch for LSTM
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

logger = logging.getLogger(__name__)


class ForecastPeriod(str, Enum):
    HOURLY = "1h"
    FOUR_HOURS = "4h"
    DAILY = "24h"
    WEEKLY = "7d"


@dataclass
class LiquidityForecast:
    """Liquidity forecast result"""
    bank_code: str
    bank_name: str
    account_number: str
    current_balance: float
    forecast_period: str
    forecast_timestamp: datetime
    predicted_inflow: float
    predicted_outflow: float
    predicted_balance: float
    confidence_lower: float
    confidence_upper: float
    confidence_level: float
    recommended_action: str
    model_used: str
    
    def to_dict(self) -> Dict:
        d = asdict(self)
        d['forecast_timestamp'] = self.forecast_timestamp.isoformat()
        return d


@dataclass
class SweepRecommendation:
    """Recommended sweep based on forecast"""
    source_bank_code: str
    source_account: str
    dest_bank_code: str
    dest_account: str
    amount: float
    reason: str
    urgency: str  # low, medium, high, critical
    recommended_time: datetime
    confidence: float
    
    def to_dict(self) -> Dict:
        d = asdict(self)
        d['recommended_time'] = self.recommended_time.isoformat()
        return d


class LSTMLiquidityModel(nn.Module):
    """LSTM model for liquidity time-series forecasting"""
    
    def __init__(
        self,
        input_size: int = 5,
        hidden_size: int = 64,
        num_layers: int = 2,
        output_size: int = 1,
        dropout: float = 0.2
    ):
        super(LSTMLiquidityModel, self).__init__()
        
        self.hidden_size = hidden_size
        self.num_layers = num_layers
        
        self.lstm = nn.LSTM(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0
        )
        
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 32),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(32, output_size)
        )
    
    def forward(self, x):
        # x shape: (batch, seq_len, input_size)
        lstm_out, _ = self.lstm(x)
        # Take the last output
        last_out = lstm_out[:, -1, :]
        output = self.fc(last_out)
        return output


class ProphetForecaster:
    """Prophet-based liquidity forecaster"""
    
    def __init__(self, model_dir: str = "./models"):
        self.model_dir = model_dir
        self.models: Dict[str, Prophet] = {}
        os.makedirs(model_dir, exist_ok=True)
    
    async def train(
        self,
        db_pool: asyncpg.Pool,
        bank_code: str,
        account_number: str,
        min_samples: int = 100
    ) -> Dict[str, float]:
        """Train Prophet model for a specific bank account"""
        if not PROPHET_AVAILABLE:
            logger.warning("Prophet not available, using fallback")
            return {'status': 'fallback'}
        
        # Fetch historical balance data
        async with db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    DATE_TRUNC('hour', created_at) as ds,
                    AVG(available_balance) as y
                FROM liquidity_snapshots
                WHERE bank_code = $1 AND account_number = $2
                AND created_at > NOW() - INTERVAL '90 days'
                GROUP BY DATE_TRUNC('hour', created_at)
                ORDER BY ds
            """, bank_code, account_number)
        
        if len(rows) < min_samples:
            # Generate synthetic data for initial training
            df = self._generate_synthetic_data(bank_code, min_samples)
        else:
            df = pd.DataFrame([dict(r) for r in rows])
        
        # Train Prophet model
        model = Prophet(
            changepoint_prior_scale=0.05,
            seasonality_prior_scale=10,
            holidays_prior_scale=10,
            daily_seasonality=True,
            weekly_seasonality=True,
            yearly_seasonality=False,
            interval_width=0.95
        )
        
        # Add custom seasonality for business hours
        model.add_seasonality(
            name='business_hours',
            period=1,
            fourier_order=5
        )
        
        model.fit(df)
        
        # Store model
        model_key = f"{bank_code}_{account_number}"
        self.models[model_key] = model
        
        # Save model
        model_path = os.path.join(self.model_dir, f"prophet_{model_key}.joblib")
        joblib.dump(model, model_path)
        
        # Evaluate on last 24 hours
        train_df = df[:-24] if len(df) > 24 else df
        test_df = df[-24:] if len(df) > 24 else df
        
        if len(test_df) > 0:
            future = model.make_future_dataframe(periods=len(test_df), freq='H')
            forecast = model.predict(future)
            
            y_true = test_df['y'].values
            y_pred = forecast['yhat'].values[-len(test_df):]
            
            mae = mean_absolute_error(y_true, y_pred)
            rmse = np.sqrt(mean_squared_error(y_true, y_pred))
            
            return {
                'status': 'trained',
                'mae': mae,
                'rmse': rmse,
                'samples': len(df)
            }
        
        return {'status': 'trained', 'samples': len(df)}
    
    def _generate_synthetic_data(self, bank_code: str, n_samples: int) -> pd.DataFrame:
        """Generate synthetic balance data for initial training"""
        np.random.seed(hash(bank_code) % 2**32)
        
        base_balance = np.random.uniform(5000000, 20000000)
        
        dates = pd.date_range(
            end=datetime.utcnow(),
            periods=n_samples,
            freq='H'
        )
        
        data = []
        balance = base_balance
        
        for dt in dates:
            # Daily pattern (higher during business hours)
            hour_factor = 1.0 + 0.1 * np.sin(2 * np.pi * dt.hour / 24 - np.pi/2)
            
            # Weekly pattern (lower on weekends)
            day_factor = 0.9 if dt.weekday() >= 5 else 1.0
            
            # Random walk with mean reversion
            change = np.random.normal(0, base_balance * 0.01)
            mean_reversion = (base_balance - balance) * 0.05
            
            balance = balance + change + mean_reversion
            balance = balance * hour_factor * day_factor
            balance = max(balance, base_balance * 0.5)  # Floor
            
            data.append({
                'ds': dt,
                'y': balance
            })
        
        return pd.DataFrame(data)
    
    def forecast(
        self,
        bank_code: str,
        account_number: str,
        periods: int = 24,
        freq: str = 'H'
    ) -> pd.DataFrame:
        """Generate forecast for a bank account"""
        model_key = f"{bank_code}_{account_number}"
        
        if model_key not in self.models:
            # Try to load from disk
            model_path = os.path.join(self.model_dir, f"prophet_{model_key}.joblib")
            if os.path.exists(model_path):
                self.models[model_key] = joblib.load(model_path)
            else:
                # Return simple forecast
                return self._simple_forecast(periods, freq)
        
        model = self.models[model_key]
        
        future = model.make_future_dataframe(periods=periods, freq=freq)
        forecast = model.predict(future)
        
        return forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].tail(periods)
    
    def _simple_forecast(self, periods: int, freq: str) -> pd.DataFrame:
        """Simple fallback forecast"""
        dates = pd.date_range(
            start=datetime.utcnow(),
            periods=periods,
            freq=freq
        )
        
        return pd.DataFrame({
            'ds': dates,
            'yhat': [0] * periods,
            'yhat_lower': [0] * periods,
            'yhat_upper': [0] * periods
        })


class LSTMForecaster:
    """LSTM-based liquidity forecaster"""
    
    def __init__(self, model_dir: str = "./models", device: str = None):
        self.model_dir = model_dir
        self.device = device or ('cuda' if torch.cuda.is_available() else 'cpu')
        self.models: Dict[str, LSTMLiquidityModel] = {}
        self.scalers: Dict[str, MinMaxScaler] = {}
        self.sequence_length = 24  # 24 hours of history
        
        os.makedirs(model_dir, exist_ok=True)
    
    async def train(
        self,
        db_pool: asyncpg.Pool,
        bank_code: str,
        account_number: str,
        epochs: int = 100,
        batch_size: int = 32,
        min_samples: int = 200
    ) -> Dict[str, float]:
        """Train LSTM model for a specific bank account"""
        # Fetch historical data
        async with db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT 
                    DATE_TRUNC('hour', created_at) as timestamp,
                    AVG(available_balance) as balance,
                    SUM(CASE WHEN transaction_type = 'credit' THEN amount ELSE 0 END) as inflow,
                    SUM(CASE WHEN transaction_type = 'debit' THEN amount ELSE 0 END) as outflow
                FROM liquidity_snapshots ls
                LEFT JOIN internal_transactions it ON ls.bank_code = it.bank_code 
                    AND ls.account_number = it.account_number
                    AND DATE_TRUNC('hour', ls.created_at) = DATE_TRUNC('hour', it.transaction_date)
                WHERE ls.bank_code = $1 AND ls.account_number = $2
                AND ls.created_at > NOW() - INTERVAL '90 days'
                GROUP BY DATE_TRUNC('hour', ls.created_at)
                ORDER BY timestamp
            """, bank_code, account_number)
        
        if len(rows) < min_samples:
            df = self._generate_synthetic_data(bank_code, min_samples)
        else:
            df = pd.DataFrame([dict(r) for r in rows])
        
        # Prepare features
        df = self._prepare_features(df)
        
        # Scale data
        model_key = f"{bank_code}_{account_number}"
        self.scalers[model_key] = MinMaxScaler()
        
        feature_cols = ['balance', 'inflow', 'outflow', 'hour', 'day_of_week']
        scaled_data = self.scalers[model_key].fit_transform(df[feature_cols])
        
        # Create sequences
        X, y = self._create_sequences(scaled_data)
        
        # Split data
        split_idx = int(len(X) * 0.8)
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_train, y_val = y[:split_idx], y[split_idx:]
        
        # Create data loaders
        train_dataset = TensorDataset(
            torch.FloatTensor(X_train),
            torch.FloatTensor(y_train)
        )
        val_dataset = TensorDataset(
            torch.FloatTensor(X_val),
            torch.FloatTensor(y_val)
        )
        
        train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
        val_loader = DataLoader(val_dataset, batch_size=batch_size)
        
        # Initialize model
        model = LSTMLiquidityModel(
            input_size=len(feature_cols),
            hidden_size=64,
            num_layers=2,
            output_size=1
        ).to(self.device)
        
        criterion = nn.MSELoss()
        optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer, mode='min', factor=0.5, patience=10
        )
        
        # Training loop
        best_val_loss = float('inf')
        patience_counter = 0
        
        for epoch in range(epochs):
            model.train()
            train_loss = 0
            
            for X_batch, y_batch in train_loader:
                X_batch = X_batch.to(self.device)
                y_batch = y_batch.to(self.device)
                
                optimizer.zero_grad()
                output = model(X_batch)
                loss = criterion(output, y_batch)
                loss.backward()
                optimizer.step()
                
                train_loss += loss.item()
            
            # Validation
            model.eval()
            val_loss = 0
            
            with torch.no_grad():
                for X_batch, y_batch in val_loader:
                    X_batch = X_batch.to(self.device)
                    y_batch = y_batch.to(self.device)
                    
                    output = model(X_batch)
                    loss = criterion(output, y_batch)
                    val_loss += loss.item()
            
            val_loss /= len(val_loader)
            scheduler.step(val_loss)
            
            # Early stopping
            if val_loss < best_val_loss:
                best_val_loss = val_loss
                patience_counter = 0
                # Save best model
                self.models[model_key] = model
            else:
                patience_counter += 1
                if patience_counter >= 20:
                    break
        
        # Save model and scaler
        model_path = os.path.join(self.model_dir, f"lstm_{model_key}.pt")
        torch.save(model.state_dict(), model_path)
        
        scaler_path = os.path.join(self.model_dir, f"scaler_{model_key}.joblib")
        joblib.dump(self.scalers[model_key], scaler_path)
        
        # Calculate metrics
        model.eval()
        with torch.no_grad():
            X_val_tensor = torch.FloatTensor(X_val).to(self.device)
            y_pred = model(X_val_tensor).cpu().numpy()
        
        # Inverse transform
        y_val_inv = self._inverse_transform_balance(y_val, model_key)
        y_pred_inv = self._inverse_transform_balance(y_pred, model_key)
        
        mae = mean_absolute_error(y_val_inv, y_pred_inv)
        rmse = np.sqrt(mean_squared_error(y_val_inv, y_pred_inv))
        
        return {
            'status': 'trained',
            'mae': mae,
            'rmse': rmse,
            'epochs': epoch + 1,
            'samples': len(df)
        }
    
    def _prepare_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Prepare features for LSTM"""
        df = df.copy()
        
        if 'timestamp' in df.columns:
            df['hour'] = pd.to_datetime(df['timestamp']).dt.hour
            df['day_of_week'] = pd.to_datetime(df['timestamp']).dt.dayofweek
        else:
            df['hour'] = 12
            df['day_of_week'] = 0
        
        # Fill missing values
        df['inflow'] = df.get('inflow', 0).fillna(0)
        df['outflow'] = df.get('outflow', 0).fillna(0)
        df['balance'] = df['balance'].fillna(method='ffill').fillna(method='bfill')
        
        return df
    
    def _create_sequences(self, data: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Create sequences for LSTM training"""
        X, y = [], []
        
        for i in range(len(data) - self.sequence_length):
            X.append(data[i:i + self.sequence_length])
            y.append(data[i + self.sequence_length, 0])  # Predict balance
        
        return np.array(X), np.array(y).reshape(-1, 1)
    
    def _generate_synthetic_data(self, bank_code: str, n_samples: int) -> pd.DataFrame:
        """Generate synthetic data for initial training"""
        np.random.seed(hash(bank_code) % 2**32)
        
        base_balance = np.random.uniform(5000000, 20000000)
        
        dates = pd.date_range(
            end=datetime.utcnow(),
            periods=n_samples,
            freq='H'
        )
        
        data = []
        balance = base_balance
        
        for dt in dates:
            # Generate inflow/outflow
            inflow = np.random.exponential(100000) if np.random.random() > 0.3 else 0
            outflow = np.random.exponential(80000) if np.random.random() > 0.4 else 0
            
            # Update balance
            balance = balance + inflow - outflow
            balance = max(balance, base_balance * 0.3)
            
            data.append({
                'timestamp': dt,
                'balance': balance,
                'inflow': inflow,
                'outflow': outflow
            })
        
        return pd.DataFrame(data)
    
    def _inverse_transform_balance(self, scaled_balance: np.ndarray, model_key: str) -> np.ndarray:
        """Inverse transform scaled balance values"""
        if model_key not in self.scalers:
            return scaled_balance
        
        scaler = self.scalers[model_key]
        
        # Create dummy array with balance in first column
        dummy = np.zeros((len(scaled_balance), scaler.n_features_in_))
        dummy[:, 0] = scaled_balance.flatten()
        
        inverse = scaler.inverse_transform(dummy)
        return inverse[:, 0]
    
    def forecast(
        self,
        bank_code: str,
        account_number: str,
        current_data: np.ndarray,
        periods: int = 24
    ) -> np.ndarray:
        """Generate forecast for a bank account"""
        model_key = f"{bank_code}_{account_number}"
        
        if model_key not in self.models:
            # Try to load from disk
            model_path = os.path.join(self.model_dir, f"lstm_{model_key}.pt")
            scaler_path = os.path.join(self.model_dir, f"scaler_{model_key}.joblib")
            
            if os.path.exists(model_path) and os.path.exists(scaler_path):
                model = LSTMLiquidityModel()
                model.load_state_dict(torch.load(model_path, map_location=self.device, weights_only=True))  # PY-014: no pickle deserialization
                self.models[model_key] = model.to(self.device)
                self.scalers[model_key] = joblib.load(scaler_path)
            else:
                # Return simple forecast
                return np.zeros(periods)
        
        model = self.models[model_key]
        model.eval()
        
        # Scale input data
        scaled_data = self.scalers[model_key].transform(current_data)
        
        # Generate forecasts iteratively
        forecasts = []
        sequence = scaled_data[-self.sequence_length:].copy()
        
        with torch.no_grad():
            for _ in range(periods):
                X = torch.FloatTensor(sequence).unsqueeze(0).to(self.device)
                pred = model(X).cpu().numpy()[0, 0]
                forecasts.append(pred)
                
                # Update sequence with prediction
                new_row = sequence[-1].copy()
                new_row[0] = pred  # Update balance
                sequence = np.vstack([sequence[1:], new_row])
        
        # Inverse transform
        forecasts = np.array(forecasts)
        return self._inverse_transform_balance(forecasts, model_key)


class LiquidityForecaster:
    """Unified liquidity forecasting service"""
    
    def __init__(
        self,
        db_pool: asyncpg.Pool,
        redis_client: redis.Redis,
        model_dir: str = "./models"
    ):
        self.db_pool = db_pool
        self.redis = redis_client
        self.model_dir = model_dir
        
        self.prophet_forecaster = ProphetForecaster(model_dir)
        self.lstm_forecaster = LSTMForecaster(model_dir)
        
        # Thresholds for recommendations
        self.thresholds: Dict[str, Dict[str, float]] = {}
    
    async def set_thresholds(
        self,
        bank_code: str,
        critical_low: float,
        low: float,
        optimal: float,
        high: float,
        critical_high: float
    ):
        """Set liquidity thresholds for a bank account"""
        self.thresholds[bank_code] = {
            'critical_low': critical_low,
            'low': low,
            'optimal': optimal,
            'high': high,
            'critical_high': critical_high
        }
        
        # Cache in Redis
        await self.redis.hset(
            f"liquidity:thresholds:{bank_code}",
            mapping={
                'critical_low': str(critical_low),
                'low': str(low),
                'optimal': str(optimal),
                'high': str(high),
                'critical_high': str(critical_high)
            }
        )
    
    async def get_thresholds(self, bank_code: str) -> Dict[str, float]:
        """Get liquidity thresholds for a bank account"""
        if bank_code in self.thresholds:
            return self.thresholds[bank_code]
        
        # Try Redis
        cached = await self.redis.hgetall(f"liquidity:thresholds:{bank_code}")
        if cached:
            thresholds = {k.decode(): float(v.decode()) for k, v in cached.items()}
            self.thresholds[bank_code] = thresholds
            return thresholds
        
        # Default thresholds
        return {
            'critical_low': 1000000,
            'low': 2000000,
            'optimal': 5000000,
            'high': 15000000,
            'critical_high': 20000000
        }
    
    async def train_models(
        self,
        bank_code: str,
        account_number: str
    ) -> Dict[str, Any]:
        """Train both Prophet and LSTM models for an account"""
        results = {}
        
        # Train Prophet
        try:
            prophet_result = await self.prophet_forecaster.train(
                self.db_pool, bank_code, account_number
            )
            results['prophet'] = prophet_result
        except Exception as e:
            logger.error(f"Prophet training failed: {e}")
            results['prophet'] = {'status': 'failed', 'error': str(e)}
        
        # Train LSTM
        try:
            lstm_result = await self.lstm_forecaster.train(
                self.db_pool, bank_code, account_number
            )
            results['lstm'] = lstm_result
        except Exception as e:
            logger.error(f"LSTM training failed: {e}")
            results['lstm'] = {'status': 'failed', 'error': str(e)}
        
        return results
    
    async def forecast(
        self,
        bank_code: str,
        bank_name: str,
        account_number: str,
        current_balance: float,
        period: ForecastPeriod = ForecastPeriod.DAILY
    ) -> LiquidityForecast:
        """Generate liquidity forecast for a bank account"""
        # Determine forecast periods
        period_hours = {
            ForecastPeriod.HOURLY: 1,
            ForecastPeriod.FOUR_HOURS: 4,
            ForecastPeriod.DAILY: 24,
            ForecastPeriod.WEEKLY: 168
        }
        hours = period_hours.get(period, 24)
        
        # Try Prophet forecast first
        try:
            prophet_forecast = self.prophet_forecaster.forecast(
                bank_code, account_number, periods=hours
            )
            
            if len(prophet_forecast) > 0 and prophet_forecast['yhat'].iloc[-1] != 0:
                predicted_balance = prophet_forecast['yhat'].iloc[-1]
                confidence_lower = prophet_forecast['yhat_lower'].iloc[-1]
                confidence_upper = prophet_forecast['yhat_upper'].iloc[-1]
                model_used = 'prophet'
            else:
                raise ValueError("Prophet forecast empty")
                
        except Exception as e:
            logger.warning(f"Prophet forecast failed, using heuristic: {e}")
            # Fallback to simple heuristic
            predicted_balance = current_balance * 0.95  # Assume 5% decrease
            confidence_lower = predicted_balance * 0.8
            confidence_upper = predicted_balance * 1.2
            model_used = 'heuristic'
        
        # Calculate predicted flows
        predicted_outflow = max(0, current_balance - predicted_balance)
        predicted_inflow = max(0, predicted_balance - current_balance + predicted_outflow)
        
        # Get thresholds and determine action
        thresholds = await self.get_thresholds(bank_code)
        recommended_action = self._get_recommended_action(predicted_balance, thresholds)
        
        # Calculate confidence level
        if confidence_upper > confidence_lower:
            confidence_range = confidence_upper - confidence_lower
            confidence_level = 1.0 - min(confidence_range / predicted_balance, 1.0) if predicted_balance > 0 else 0.5
        else:
            confidence_level = 0.75
        
        return LiquidityForecast(
            bank_code=bank_code,
            bank_name=bank_name,
            account_number=account_number,
            current_balance=current_balance,
            forecast_period=period.value,
            forecast_timestamp=datetime.utcnow() + timedelta(hours=hours),
            predicted_inflow=predicted_inflow,
            predicted_outflow=predicted_outflow,
            predicted_balance=predicted_balance,
            confidence_lower=confidence_lower,
            confidence_upper=confidence_upper,
            confidence_level=confidence_level,
            recommended_action=recommended_action,
            model_used=model_used
        )
    
    def _get_recommended_action(
        self,
        predicted_balance: float,
        thresholds: Dict[str, float]
    ) -> str:
        """Determine recommended action based on predicted balance"""
        if predicted_balance < thresholds['critical_low']:
            return "URGENT_FUND: Predicted balance critically low, immediate funding required"
        elif predicted_balance < thresholds['low']:
            return "FUND: Predicted balance below threshold, schedule funding"
        elif predicted_balance > thresholds['critical_high']:
            return "URGENT_SWEEP: Predicted balance critically high, immediate sweep required"
        elif predicted_balance > thresholds['high']:
            return "SWEEP: Predicted balance above threshold, schedule sweep"
        else:
            return "HOLD: Predicted balance within optimal range"
    
    async def generate_sweep_recommendations(
        self,
        accounts: List[Dict[str, Any]]
    ) -> List[SweepRecommendation]:
        """Generate sweep recommendations based on forecasts"""
        recommendations = []
        
        # Forecast all accounts
        forecasts = []
        for account in accounts:
            forecast = await self.forecast(
                bank_code=account['bank_code'],
                bank_name=account['bank_name'],
                account_number=account['account_number'],
                current_balance=account['available_balance'],
                period=ForecastPeriod.DAILY
            )
            forecasts.append((account, forecast))
        
        # Identify accounts needing funding and those with surplus
        needs_funding = []
        has_surplus = []
        
        for account, forecast in forecasts:
            thresholds = await self.get_thresholds(account['bank_code'])
            
            if forecast.predicted_balance < thresholds['low']:
                deficit = thresholds['optimal'] - forecast.predicted_balance
                needs_funding.append((account, forecast, deficit))
            elif forecast.predicted_balance > thresholds['high']:
                surplus = forecast.predicted_balance - thresholds['optimal']
                has_surplus.append((account, forecast, surplus))
        
        # Sort by urgency
        needs_funding.sort(key=lambda x: x[2], reverse=True)  # Largest deficit first
        has_surplus.sort(key=lambda x: x[2], reverse=True)    # Largest surplus first
        
        # Generate recommendations
        for deficit_account, deficit_forecast, deficit in needs_funding:
            remaining_deficit = deficit
            
            for surplus_account, surplus_forecast, surplus in has_surplus:
                if remaining_deficit <= 0:
                    break
                if surplus <= 0:
                    continue
                
                sweep_amount = min(remaining_deficit, surplus)
                
                # Determine urgency
                thresholds = await self.get_thresholds(deficit_account['bank_code'])
                if deficit_forecast.predicted_balance < thresholds['critical_low']:
                    urgency = 'critical'
                elif deficit_forecast.predicted_balance < thresholds['low']:
                    urgency = 'high'
                else:
                    urgency = 'medium'
                
                recommendation = SweepRecommendation(
                    source_bank_code=surplus_account['bank_code'],
                    source_account=surplus_account['account_number'],
                    dest_bank_code=deficit_account['bank_code'],
                    dest_account=deficit_account['account_number'],
                    amount=sweep_amount,
                    reason=f"Rebalance: {surplus_account['bank_name']} surplus to {deficit_account['bank_name']} deficit",
                    urgency=urgency,
                    recommended_time=datetime.utcnow() + timedelta(hours=1),
                    confidence=min(deficit_forecast.confidence_level, surplus_forecast.confidence_level)
                )
                
                recommendations.append(recommendation)
                remaining_deficit -= sweep_amount
                surplus -= sweep_amount
        
        return recommendations
    
    async def get_forecast_summary(
        self,
        accounts: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Get summary of forecasts for all accounts"""
        forecasts = []
        total_current = 0
        total_predicted = 0
        
        for account in accounts:
            forecast = await self.forecast(
                bank_code=account['bank_code'],
                bank_name=account['bank_name'],
                account_number=account['account_number'],
                current_balance=account['available_balance']
            )
            forecasts.append(forecast.to_dict())
            total_current += account['available_balance']
            total_predicted += forecast.predicted_balance
        
        # Count by action
        action_counts = {}
        for f in forecasts:
            action = f['recommended_action'].split(':')[0]
            action_counts[action] = action_counts.get(action, 0) + 1
        
        return {
            'total_accounts': len(accounts),
            'total_current_balance': total_current,
            'total_predicted_balance': total_predicted,
            'predicted_change': total_predicted - total_current,
            'predicted_change_pct': (total_predicted - total_current) / total_current * 100 if total_current > 0 else 0,
            'action_summary': action_counts,
            'forecasts': forecasts,
            'generated_at': datetime.utcnow().isoformat()
        }
