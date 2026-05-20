
from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import redis
import json
import logging
from logging.handlers import RotatingFileHandler

app = Flask(__name__)
CORS(app) # Enable CORS for all origins

# Configure logging
log_file = 'fraud_detection_service.log'
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
                    handlers=[
                        RotatingFileHandler(log_file, maxBytes=1000000, backupCount=5),
                        logging.StreamHandler()
                    ])
logger = logging.getLogger(__name__)

# Configure Redis
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
REDIS_DB = int(os.getenv('REDIS_DB', 0))
redis_client = redis.StrictRedis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)

@app.route('/')
def home():
    logger.info("Home endpoint accessed.")
    return "ML Fraud Detection Service is running!"

@app.route('/predict', methods=['POST'])
def predict():
    logger.info("Predict endpoint accessed.")
    data = request.get_json(force=True)
    if not data:
        logger.warning("No data received for prediction.")
        return jsonify({"error": "No data provided"}), 400

    transaction_id = data.get('transaction_id', 'N/A')
    logger.info(f"Received prediction request for transaction_id: {transaction_id}")

    # Feature Engineering and Inference
    try:
        features = pd.DataFrame({
            'amount': [data.get('amount', 0)],
            'transaction_frequency': [data.get('transaction_frequency', 1)],
            'user_age': [data.get('user_age', 30)],
            'is_international': [data.get('is_international', 0)]
        })

        if scaler is None or model is None:
            logger.error("ML model or scaler not loaded. Retrying load...")
            load_model_and_scaler()
            if scaler is None or model is None:
                return jsonify({"error": "ML model not available"}), 500

        features_scaled = scaler.transform(features)
        prediction_proba = model.predict_proba(features_scaled)[:, 1][0]
        is_fraud = bool(prediction_proba > 0.5) # Threshold for fraud

        response = {"transaction_id": transaction_id, "is_fraud": is_fraud, "score": float(prediction_proba)}

        # Cache the prediction result
        try:
            redis_client.setex(f"prediction:{transaction_id}", 3600, json.dumps(response))
            logger.info(f"Prediction for {transaction_id} cached in Redis.")
        except Exception as e:
            logger.error(f"Error caching prediction for {transaction_id}: {e}")

        # Save transaction to database
        try:
            new_transaction = Transaction(
                transaction_id=transaction_id,
                user_id=data.get("user_id", "unknown"),
                amount=data.get('amount', 0),
                currency=data.get("currency", "USD"),
                is_fraud=is_fraud,
                prediction_score=response["score"],
                model_version="RandomForest_v1.0" # Specific model version
            )
            db.session.add(new_transaction)
            db.session.commit()
            logger.info(f"Transaction {transaction_id} saved to database.")
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error saving transaction {transaction_id} to database: {e}")

        return jsonify(response)

    except Exception as e:
        logger.error(f"Error during ML prediction for {transaction_id}: {e}")
        return jsonify({"error": "ML prediction failed", "details": str(e)}), 500



if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)





# Database Configuration
from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

app.config["SQLALCHEMY_DATABASE_URI"] = os.getenv("DATABASE_URL", "sqlite:///fraud_detection.db")
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

# Database Models
class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    transaction_id = db.Column(db.String(100), unique=True, nullable=False)
    user_id = db.Column(db.String(100), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    currency = db.Column(db.String(10), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    is_fraud = db.Column(db.Boolean, default=False)
    prediction_score = db.Column(db.Float, default=0.0)
    model_version = db.Column(db.String(50))

    def __repr__(self):
        return f"<Transaction {self.transaction_id}>"

# Create database tables (call this once, e.g., on service startup or first request)
with app.app_context():
    db.create_all()






# ML Model Integration
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score
import joblib

# Placeholder for model path
MODEL_PATH = 'fraud_detection_model.pkl'

# Function to train and save the model
def train_and_save_model():
    logger.info("Starting model training...")
    # In a real application, you would load data from a database or data lake
    # For demonstration, let's create some synthetic data
    np.random.seed(42)
    data_size = 10000
    data = {
        'amount': np.random.normal(500, 200, data_size),
        'transaction_frequency': np.random.randint(1, 10, data_size),
        'user_age': np.random.randint(18, 70, data_size),
        'is_international': np.random.choice([0, 1], data_size, p=[0.8, 0.2]),
        'is_fraud': np.random.choice([0, 1], data_size, p=[0.95, 0.05]) # 5% fraud
    }
    df = pd.DataFrame(data)

    # Introduce some correlation for fraud
    df.loc[df['is_fraud'] == 1, 'amount'] = np.random.normal(1500, 500, df[df['is_fraud'] == 1].shape[0])
    df.loc[df['is_fraud'] == 1, 'transaction_frequency'] = np.random.randint(8, 15, df[df['is_fraud'] == 1].shape[0])

    X = df[['amount', 'transaction_frequency', 'user_age', 'is_international']]
    y = df['is_fraud']

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(X_train)
    X_test_scaled = scaler.transform(X_test)

    model = RandomForestClassifier(n_estimators=100, random_state=42, class_weight='balanced')
    model.fit(X_train_scaled, y_train)

    y_pred = model.predict(X_test_scaled)
    logger.info(f"Model Accuracy: {accuracy_score(y_test, y_pred)}")
    logger.info(f"Classification Report:\n{classification_report(y_test, y_pred)}")

    joblib.dump(model, MODEL_PATH)
    joblib.dump(scaler, 'scaler.pkl')
    logger.info(f"Model and scaler saved to {MODEL_PATH} and scaler.pkl")

# Load the trained model and scaler
model = None
scaler = None

def load_model_and_scaler():
    global model, scaler
    if os.path.exists(MODEL_PATH) and os.path.exists('scaler.pkl'):
        model = joblib.load(MODEL_PATH)
        scaler = joblib.load('scaler.pkl')
        logger.info("ML model and scaler loaded successfully.")
    else:
        logger.warning("ML model or scaler not found. Training a new one...")
        train_and_save_model()
        model = joblib.load(MODEL_PATH)
        scaler = joblib.load('scaler.pkl')

# Call to load model on startup
with app.app_context():
    load_model_and_scaler()

# Update the predict endpoint to use the ML model
@app.route('/predict', methods=['POST'])
def predict():
    logger.info("Predict endpoint accessed.")
    data = request.get_json(force=True)
    if not data:
        logger.warning("No data received for prediction.")
        return jsonify({"error": "No data provided"}), 400

    transaction_id = data.get('transaction_id', 'N/A')
    logger.info(f"Received prediction request for transaction_id: {transaction_id}")

    # Feature Engineering and Inference
    try:
        features = pd.DataFrame({
            'amount': [data.get('amount', 0)],
            'transaction_frequency': [data.get('transaction_frequency', 1)],
            'user_age': [data.get('user_age', 30)],
            'is_international': [data.get('is_international', 0)]
        })

        if scaler is None or model is None:
            logger.error("ML model or scaler not loaded. Retrying load...")
            load_model_and_scaler()
            if scaler is None or model is None:
                return jsonify({"error": "ML model not available"}), 500

        features_scaled = scaler.transform(features)
        prediction_proba = model.predict_proba(features_scaled)[:, 1][0]
        is_fraud = bool(prediction_proba > 0.5) # Threshold for fraud

        response = {"transaction_id": transaction_id, "is_fraud": is_fraud, "score": float(prediction_proba)}

        # Cache the prediction result
        try:
            redis_client.setex(f"prediction:{transaction_id}", 3600, json.dumps(response))
            logger.info(f"Prediction for {transaction_id} cached in Redis.")
        except Exception as e:
            logger.error(f"Error caching prediction for {transaction_id}: {e}")

        # Save transaction to database
        try:
            new_transaction = Transaction(
                transaction_id=transaction_id,
                user_id=data.get("user_id", "unknown"),
                amount=data.get('amount', 0),
                currency=data.get("currency", "USD"),
                is_fraud=is_fraud,
                prediction_score=response["score"],
                model_version="RandomForest_v1.0" # Specific model version
            )
            db.session.add(new_transaction)
            db.session.commit()
            logger.info(f"Transaction {transaction_id} saved to database.")
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error saving transaction {transaction_id} to database: {e}")

        return jsonify(response)

    except Exception as e:
        logger.error(f"Error during ML prediction for {transaction_id}: {e}")
        return jsonify({"error": "ML prediction failed", "details": str(e)}), 500






@app.route("/health", methods=["GET"])
def health_check():
    try:
        # Check database connection
        db.session.execute(db.select(Transaction).limit(1))
        db_status = "OK"
    except Exception as e:
        db_status = f"Error: {e}"
        logger.error(f"Database health check failed: {e}")

    try:
        # Check Redis connection
        redis_client.ping()
        redis_status = "OK"
    except Exception as e:
        redis_status = f"Error: {e}"
        logger.error(f"Redis health check failed: {e}")

    # Check ML model status
    ml_model_status = "OK" if model is not None and scaler is not None else "Not Loaded"
    if ml_model_status == "Not Loaded":
        logger.warning("ML model or scaler not loaded during health check.")

    overall_status = "OK" if db_status == "OK" and redis_status == "OK" and ml_model_status == "OK" else "Degraded"

    return jsonify({
        "status": overall_status,
        "database": db_status,
        "redis": redis_status,
        "ml_model": ml_model_status,
        "timestamp": datetime.utcnow().isoformat()
    }), 200 if overall_status == "OK" else 503



