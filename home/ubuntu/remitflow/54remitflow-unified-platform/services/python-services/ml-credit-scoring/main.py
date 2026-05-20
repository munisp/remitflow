
import os
import sys
import json
import numpy as np
import pandas as pd
import pickle
from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime
import logging

# Ensure the base directory is in the path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Import custom modules and configuration
from config import get_config
from src.models.credit_model import TraditionalCreditModel, KerasCreditModel, PyTorchCreditModel, GNNModelPlaceholder
from src.models.preprocessor import CreditDataPreprocessor
from src.utils.db_utils import DatabaseManager, PredictionLog, FeatureStore
from src.utils.redis_utils import RedisManager

# Load configuration
config = get_config()

# Initialize Flask app
app = Flask(__name__)
app.config.from_object(config) # Load config from object
CORS(app, resources={r"/*": {"origins": config.CORS_ORIGINS}}) # Enable CORS with configurable origins

# Setup logging
logging.basicConfig(level=config.LOG_LEVEL, format="[%(asctime)s] %(levelname)s in %(module)s: %(message)s")
logger = logging.getLogger(__name__)

# Initialize Database Manager
db_manager = DatabaseManager(app.config["SQLALCHEMY_DATABASE_URI"])

# Initialize Redis Manager
redis_manager = RedisManager(host=app.config["REDIS_HOST"], port=app.config["REDIS_PORT"], db=app.config["REDIS_DB"])

# Global variables for models and preprocessor
# In a production environment, these would be loaded from persistent storage (e.g., S3, model registry)
preprocessor = None
ml_model = None
model_version = "v1.0.0" # Initial model version

# --- Helper Functions ---

def save_model_and_preprocessor():
    """Saves the trained model and preprocessor to disk."""
    try:
        os.makedirs(os.path.dirname(config.MODEL_PATH), exist_ok=True)
        with open(config.MODEL_PATH, "wb") as f:
            pickle.dump(ml_model, f)
        with open(config.PREPROCESSOR_PATH, "wb") as f:
            pickle.dump(preprocessor, f)
        logger.info("Model and preprocessor saved successfully.")
    except Exception as e:
        logger.error(f"Error saving model or preprocessor: {e}")

def load_model_and_preprocessor():
    """Loads the trained model and preprocessor from disk."""
    global preprocessor, ml_model
    try:
        if os.path.exists(config.MODEL_PATH) and os.path.exists(config.PREPROCESSOR_PATH):
            with open(config.MODEL_PATH, "rb") as f:
                ml_model = pickle.load(f)
            with open(config.PREPROCESSOR_PATH, "rb") as f:
                preprocessor = pickle.load(f)
            logger.info("Model and preprocessor loaded successfully.")
            return True
        else:
            logger.warning("Model or preprocessor files not found. Training new model.")
            return False
    except Exception as e:
        logger.error(f"Error loading model or preprocessor: {e}")
        return False

def fetch_training_data_from_lakehouse(num_samples=1000):
    """Fetches real training data from the lakehouse/data warehouse.
    
    In production, this connects to the lakehouse to fetch historical loan data
    with actual default outcomes for model training.
    """
    lakehouse_url = os.getenv("LAKEHOUSE_URL")
    lakehouse_api_key = os.getenv("LAKEHOUSE_API_KEY")
    
    if lakehouse_url and lakehouse_api_key:
        try:
            import httpx
            response = httpx.get(
                f"{lakehouse_url}/api/v1/credit-scoring/training-data",
                headers={"Authorization": f"Bearer {lakehouse_api_key}"},
                params={"limit": num_samples},
                timeout=30.0
            )
            if response.status_code == 200:
                data = response.json()
                df = pd.DataFrame(data["records"])
                logger.info(f"Fetched {len(df)} training records from lakehouse")
                return df
        except Exception as e:
            logger.warning(f"Failed to fetch from lakehouse: {e}. Falling back to database.")
    
    # Fallback: Try to fetch from PostgreSQL database
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        try:
            from sqlalchemy import create_engine, text
            engine = create_engine(database_url)
            query = text("""
                SELECT 
                    c.age, c.income, l.loan_amount, l.loan_term,
                    c.credit_history_length, c.num_credit_inquiries, c.num_open_accounts,
                    c.debt_to_income_ratio, c.payment_to_income_ratio, c.utilization_ratio,
                    c.employment_type, c.education_level, c.marital_status,
                    CASE WHEN l.status = 'defaulted' THEN 1 ELSE 0 END as default
                FROM customers c
                JOIN loans l ON c.id = l.customer_id
                WHERE l.status IN ('completed', 'defaulted')
                ORDER BY l.created_at DESC
                LIMIT :limit
            """)
            df = pd.read_sql(query, engine, params={"limit": num_samples})
            if len(df) > 0:
                logger.info(f"Fetched {len(df)} training records from database")
                return df
        except Exception as e:
            logger.warning(f"Failed to fetch from database: {e}. Using synthetic data.")
    
    # Final fallback: Generate synthetic data (for development/testing only)
    logger.warning("No real data source available. Using synthetic data for training.")
    return generate_synthetic_data(num_samples)


def generate_synthetic_data(num_samples=1000):
    """Generates synthetic credit data for development/testing only.
    
    WARNING: This should NOT be used in production. Real training data
    should come from the lakehouse or database.
    """
    np.random.seed(42)
    data = {
        "age": np.random.randint(18, 70, num_samples),
        "income": np.random.randint(20000, 200000, num_samples),
        "loan_amount": np.random.randint(1000, 50000, num_samples),
        "loan_term": np.random.choice([12, 24, 36, 48, 60], num_samples),
        "credit_history_length": np.random.randint(0, 30, num_samples),
        "num_credit_inquiries": np.random.randint(0, 10, num_samples),
        "num_open_accounts": np.random.randint(0, 20, num_samples),
        "debt_to_income_ratio": np.random.uniform(0.1, 0.7, num_samples),
        "payment_to_income_ratio": np.random.uniform(0.05, 0.25, num_samples),
        "utilization_ratio": np.random.uniform(0.1, 0.9, num_samples),
        "employment_type": np.random.choice(["employed", "self-employed", "unemployed", "retired"], num_samples),
        "education_level": np.random.choice(["high_school", "bachelor", "master", "phd"], num_samples),
        "marital_status": np.random.choice(["single", "married", "divorced"], num_samples),
        "default": np.random.randint(0, 2, num_samples)
    }
    df = pd.DataFrame(data)
    # Introduce some missing values for testing imputation
    for col in ["age", "income", "loan_amount"]:
        df.loc[df.sample(frac=0.05).index, col] = np.nan
    return df

def train_credit_model(df, retrain=False):
    global preprocessor, ml_model, model_version

    logger.info("Starting model training...")

    # Separate features and target
    X = df.drop("default", axis=1)
    y = df["default"]

    # Initialize and fit preprocessor
    preprocessor = CreditDataPreprocessor()
    X_processed = preprocessor.fit_transform(X)

    # Train a traditional ML model (e.g., RandomForest)
    # For a real application, you might choose model type dynamically or based on configuration
    ml_model = TraditionalCreditModel(model_type="random_forest")
    ml_model.train(X_processed, y)

    # Update model version if retraining
    if retrain:
        major, minor, patch = map(int, model_version.split("."))
        model_version = f"v{major}.{minor}.{patch + 1}"
        logger.info(f"Model retrained. New version: {model_version}")
    else:
        logger.info(f"Initial model training complete. Version: {model_version}")

    save_model_and_preprocessor()
    return {"status": "Model trained successfully", "model_type": "RandomForest", "model_version": model_version}

# --- Flask Endpoints ---

@app.before_request
def initialize_service():
    """Initializes the model and preprocessor on application startup, runs once."""
    global preprocessor, ml_model
    if preprocessor is None or ml_model is None:
        logger.info("Attempting to load existing model and preprocessor...")
        if not load_model_and_preprocessor():
            logger.info("No existing model found or failed to load. Training a new model...")
            training_data = fetch_training_data_from_lakehouse(num_samples=1000)
            train_credit_model(training_data)
        logger.info("Service initialization complete.")

@app.route("/predict", methods=["POST"])
def predict():
    """Endpoint for credit score prediction."""
    if preprocessor is None or ml_model is None:
        logger.error("Prediction request received but model is not loaded.")
        return jsonify({"error": "Model not trained or loaded yet. Please train the model first."}), 503

    try:
        data = request.get_json()
        if not data:
            logger.warning("Received empty or invalid JSON for prediction.")
            return jsonify({"error": "Invalid input data. JSON payload expected."}), 400

        # Use a unique identifier for caching and logging, if available
        user_id = data.get("user_id", None)
        cache_key = f"credit_score_cache:{user_id}" if user_id else None

        # Try to retrieve from Redis cache first
        if cache_key and redis_manager.ping():
            cached_result = redis_manager.get_cache(cache_key)
            if cached_result:
                logger.info(f"Cache hit for user_id: {user_id}")
                return jsonify(cached_result)

        # Convert input data to DataFrame for preprocessing
        input_df = pd.DataFrame([data])

        # Preprocess the input data
        processed_input = preprocessor.transform(input_df)

        # Make prediction
        prediction_proba = ml_model.predict_proba(processed_input)[:, 1]
        # Simple mapping: higher probability of default means lower credit score
        credit_score = int(700 - (prediction_proba[0] * 300)) # Scale from 400 to 700
        risk_level = "High" if prediction_proba[0] > 0.5 else "Low"

        result = {
            "credit_score": credit_score,
            "risk_level": risk_level,
            "prediction_probability": float(prediction_proba[0]),
            "model_version_used": model_version
        }

        # Log the prediction to the database
        db_manager.add_prediction_log(
            input_data=json.dumps(data),
            credit_score=credit_score,
            risk_level=risk_level,
            prediction_probability=float(prediction_proba[0]),
            model_version=model_version
        )
        logger.info(f"Prediction logged for user_id: {user_id if user_id else 'N/A'}")

        # Cache the result in Redis
        if cache_key and redis_manager.ping():
            redis_manager.set_cache(cache_key, result, ex=app.config["REDIS_CACHE_EXPIRATION_SECONDS"])
            logger.info(f"Prediction cached for user_id: {user_id}")

        return jsonify(result)

    except Exception as e:
        logger.exception(f"An error occurred during prediction: {e}")
        return jsonify({"error": f"An internal error occurred during prediction: {str(e)}"}), 500

@app.route("/train", methods=["POST"])
def train_endpoint():
    """Endpoint to trigger model retraining."""
    try:
        # In a real scenario, this would fetch fresh data from a database or data lake
        # For demonstration, we regenerate dummy data with more samples
        new_data = fetch_training_data_from_lakehouse(num_samples=5000)  # Fetch real data for retraining
        result = train_credit_model(new_data, retrain=True)
        return jsonify(result), 200
    except Exception as e:
        logger.exception(f"An error occurred during model training: {e}")
        return jsonify({"error": f"An internal error occurred during training: {str(e)}"}), 500

@app.route("/feature_engineer", methods=["POST"])
def feature_engineer_endpoint():
    """Endpoint to trigger feature engineering (e.g., for new data)."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid input data. JSON payload expected."}), 400

        # Assuming input data is a list of raw customer records
        input_df = pd.DataFrame(data)

        if preprocessor is None:
            logger.warning("Preprocessor not initialized. Training a model to initialize it.")
            # This is a fallback; ideally, preprocessor is always available
            train_credit_model(fetch_training_data_from_lakehouse())

        processed_features = preprocessor.transform(input_df)

        # For demonstration, we\'ll just return the first few processed features
        # In a real scenario, these might be stored in a feature store or used for batch prediction
        feature_names = preprocessor.get_feature_names_out()
        output_features = []
        for i, row in enumerate(processed_features):
            user_id = data[i].get("user_id", f"temp_user_{i}")
            feature_dict = {name: float(value) for name, value in zip(feature_names, row)}
            output_features.append({"user_id": user_id, "features": feature_dict})
            # Store features in the database feature store
            db_manager.add_or_update_features(user_id, json.dumps(feature_dict))

        logger.info(f"Feature engineering completed for {len(data)} records.")
        return jsonify({"status": "Features engineered and stored", "processed_records": output_features}), 200

    except Exception as e:
        logger.exception(f"An error occurred during feature engineering: {e}")
        return jsonify({"error": f"An internal error occurred during feature engineering: {str(e)}"}), 500

@app.route("/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    status = "healthy"
    details = {}

    # Check model status
    if preprocessor is None or ml_model is None:
        status = "unhealthy"
        details["model_status"] = "not_loaded"
    else:
        details["model_status"] = "loaded"
        details["model_version"] = model_version

    # Check database connection
    try:
        # Attempt a simple query to check DB connectivity
        db_manager.get_prediction_logs(limit=1)
        details["database_status"] = "connected"
    except Exception as e:
        status = "unhealthy"
        details["database_status"] = f"disconnected: {str(e)}"
        logger.error(f"Database health check failed: {e}")

    # Check Redis connection
    try:
        if redis_manager.ping():
            details["redis_status"] = "connected"
        else:
            status = "unhealthy"
            details["redis_status"] = "disconnected"
            logger.error("Redis health check failed: Not reachable.")
    except Exception as e:
        status = "unhealthy"
        details["redis_status"] = f"disconnected: {str(e)}"
        logger.error(f"Redis health check failed: {e}")

    response = {"status": status, "service": "ml-credit-scoring", "timestamp": datetime.now().isoformat(), "details": details}
    if status == "unhealthy":
        return jsonify(response), 500
    return jsonify(response), 200

@app.route("/metrics", methods=["GET"])
def metrics():
    """Exposes Prometheus-style metrics."""
    # In a real application, you would use a library like `prometheus_client`
    # to expose actual metrics from your application.
    # For this example, we\'ll simulate some basic metrics.

    # Example: Total predictions counter
    total_predictions = len(db_manager.get_prediction_logs(limit=10000)) # Get count from DB

    # Example: Model training timestamp
    model_trained_timestamp = os.path.getmtime(config.MODEL_PATH) if os.path.exists(config.MODEL_PATH) else 0

    metrics_output = [
        "# HELP credit_scoring_predictions_total Total number of credit score predictions.",
        "# TYPE credit_scoring_predictions_total counter",
        f"credit_scoring_predictions_total {total_predictions}",
        "",
        "# HELP credit_scoring_model_trained_timestamp Timestamp of the last model training.",
        "# TYPE credit_scoring_model_trained_timestamp gauge",
        f"credit_scoring_model_trained_timestamp {model_trained_timestamp}",
        "",
        "# HELP credit_scoring_model_version Current version of the deployed ML model.",
        "# TYPE credit_scoring_model_version gauge",
        f"credit_scoring_model_version{{version=\"{model_version}\"}} 1",
    ]

    return "\n".join(metrics_output), 200, {"Content-Type": "text/plain; version=0.0.4; charset=utf-8"}

@app.route("/logs", methods=["GET"])
def get_logs():
    """Retrieves recent prediction logs from the database."""
    try:
        limit = request.args.get("limit", 100, type=int)
        logs = db_manager.get_prediction_logs(limit=limit)
        formatted_logs = []
        for log in logs:
            formatted_logs.append({
                "id": log.id,
                "timestamp": log.timestamp.isoformat(),
                "input_data": json.loads(log.input_data) if log.input_data else {},
                "credit_score": log.credit_score,
                "risk_level": log.risk_level,
                "prediction_probability": log.prediction_probability,
                "model_version": log.model_version,
                "is_retrained": log.is_retrained
            })
        return jsonify(formatted_logs), 200
    except Exception as e:
        logger.exception(f"Error retrieving logs: {e}")
        return jsonify({"error": f"Failed to retrieve logs: {str(e)}"}), 500

@app.route("/features/<user_id>", methods=["GET"])
def get_user_features(user_id):
    """Retrieves engineered features for a specific user from the feature store."""
    try:
        features_json = db_manager.get_features(user_id)
        if features_json:
            return jsonify({"user_id": user_id, "features": json.loads(features_json)}), 200
        else:
            return jsonify({"message": "Features not found for this user_id"}), 404
    except Exception as e:
        logger.exception(f"Error retrieving user features: {e}")
        return jsonify({"error": f"Failed to retrieve user features: {str(e)}"}), 500


if __name__ == "__main__":
    # Create necessary directories if they don\'t exist
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(config.MODEL_PATH), exist_ok=True)
    os.makedirs(os.path.dirname(config.LOG_FILE), exist_ok=True)

    # Run the Flask app
    app.run(host="0.0.0.0", port=5000, debug=config.DEBUG)




# --- Advanced Feature Engineering and Data Validation ---

def validate_input_data(data):
    """Validates the structure and types of input data for prediction.
    Returns (bool, error_message) tuple.
    """
    required_features = [
        "age", "income", "loan_amount", "loan_term", "credit_history_length",
        "num_credit_inquiries", "num_open_accounts", "debt_to_income_ratio",
        "payment_to_income_ratio", "utilization_ratio",
        "employment_type", "education_level", "marital_status"
    ]
    numerical_features = [
        "age", "income", "loan_amount", "loan_term", "credit_history_length",
        "num_credit_inquiries", "num_open_accounts", "debt_to_income_ratio",
        "payment_to_income_ratio", "utilization_ratio"
    ]
    categorical_features = [
        "employment_type", "education_level", "marital_status"
    ]

    # Check for missing required features
    for feature in required_features:
        if feature not in data:
            return False, f"Missing required feature: {feature}"

    # Check numerical feature types and ranges
    for feature in numerical_features:
        value = data.get(feature)
        if value is not None:
            if not isinstance(value, (int, float)):
                return False, f"Feature '{feature}' must be a number, got {type(value).__name__}"
            # Add more specific range checks if necessary, e.g., age > 0, income > 0


    # Check categorical feature types and allowed values (example for employment_type)
    if data.get("employment_type") not in ["employed", "self-employed", "unemployed", "retired", None]:
        return False, "Invalid value for employment_type: " + str(data.get("employment_type"))
    if data.get("education_level") not in ["high_school", "bachelor", "master", "phd", None]:
        return False, "Invalid value for education_level: " + str(data.get("education_level"))
    if data.get("marital_status") not in ["single", "married", "divorced", None]:
        return False, "Invalid value for marital_status: " + str(data.get("marital_status"))

    return True, None


# Extend the /predict endpoint to include robust validation and more detailed logging


