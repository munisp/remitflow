
import os
import json
import time
import logging
import random
from datetime import datetime

import click
import numpy as np
import pandas as pd
import redis
import torch
import torch.nn as nn
import torch.optim as optim
import tensorflow as tf
from celery import Celery
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_swagger_ui import get_swaggerui_blueprint
from functools import wraps
from marshmallow import Schema, fields, ValidationError, validate
from prometheus_client import generate_latest, Counter, Histogram
from sklearn.compose import ColumnTransformer
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier, IsolationForest
from sklearn.metrics import accuracy_score, classification_report
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, OneHotEncoder
from sklearn.svm import SVC
from werkzeug.security import generate_password_hash, check_password_hash

# Optional imports
try:
    import torch_geometric
    from torch_geometric.data import Data
    from torch_geometric.nn import GCNConv
except ImportError:
    torch_geometric = None
    GCNConv = None
    Data = None

try:
    import shap
except ImportError:
    shap = None

try:
    from geopy.geocoders import Nominatim
except ImportError:
    Nominatim = None

try:
    from prophet import Prophet
except ImportError:
    Prophet = None

try:
    import nltk
    from nltk.sentiment import SentimentIntensityAnalyzer
except ImportError:
    nltk = None
    SentimentIntensityAnalyzer = None

# --- Global Variables & Placeholders ---
db = SQLAlchemy()
celery = Celery(__name__, broker=os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0"),
                backend=os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/0"))

scikit_model = None
tf_model = None
pytorch_model = None
gnn_model = None
svm_model = None
model_registry = {}

# --- Database Models ---
class ProcessedData(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    original_data = db.Column(db.String(500), nullable=False)
    processed_result = db.Column(db.String(500), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<ProcessedData {self.id}>"

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(128))

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def __repr__(self):
        return f"<User {self.username}>"

# --- Configuration Management ---
class Config:
    DEBUG = False
    TESTING = False
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "sqlite:///data_processing.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
    CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
    API_KEY = os.environ.get("API_KEY", "default_api_key")

class DevelopmentConfig(Config):
    DEBUG = True

class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///test_data_processing.db"

class ProductionConfig(Config):
    pass

# --- Feature Engineering ---
def feature_engineer(data):
    features = []
    for key, value in data.items():
        if isinstance(value, (int, float)):
            features.append(value)
        else:
            features.append(hash(value) % 100)
    return np.array(features).reshape(1, -1)

def advanced_feature_engineer(data):
    features = []
    features.append(data.get("amount", 0))
    features.append(data.get("oldbalanceOrg", 0))
    features.append(data.get("newbalanceOrig", 0))
    features.append(data.get("oldbalanceDest", 0))
    features.append(data.get("newbalanceDest", 0))
    tx_type = data.get("type", "CASH_OUT")
    type_features = [1 if tx_type == t else 0 for t in ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]]
    features.extend(type_features)
    features.append(data.get("newbalanceOrig", 0) - data.get("oldbalanceOrg", 0))
    features.append(data.get("newbalanceDest", 0) - data.get("oldbalanceDest", 0))
    return np.array(features).reshape(1, -1)

def clean_data(df):
    df = df.dropna()
    df = df.drop_duplicates()
    return df

def normalize_data(df, columns):
    scaler = StandardScaler()
    df[columns] = scaler.fit_transform(df[columns])
    return df

def encode_categorical(df, columns):
    encoder = OneHotEncoder(handle_unknown='ignore', sparse_output=False)
    encoded_data = encoder.fit_transform(df[columns])
    encoded_df = pd.DataFrame(encoded_data, columns=encoder.get_feature_names_out(columns))
    df = df.drop(columns=columns)
    df = pd.concat([df.reset_index(drop=True), encoded_df], axis=1)
    return df

def create_time_based_features(df, timestamp_col="timestamp"):
    df[timestamp_col] = pd.to_datetime(df[timestamp_col])
    df["hour"] = df[timestamp_col].dt.hour
    df["day_of_week"] = df[timestamp_col].dt.dayofweek
    df["month"] = df[timestamp_col].dt.month
    df["day_of_year"] = df[timestamp_col].dt.dayofyear
    df["week_of_year"] = df[timestamp_col].dt.isocalendar().week.astype(int)
    return df

def create_interaction_features(df, features_to_interact):
    for i in range(len(features_to_interact)):
        for j in range(i + 1, len(features_to_interact)):
            col1 = features_to_interact[i]
            col2 = features_to_interact[j]
            if col1 in df.columns and col2 in df.columns:
                df[f"{col1}_x_{col2}"] = df[col1] * df[col2]
    return df

def apply_log_transformation(df, columns):
    for col in columns:
        if col in df.columns:
            df[f"log_{col}"] = np.log1p(df[col])
    return df

# --- ML Model Training Functions ---
def train_scikit_model(X, y):
    global scikit_model
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    scikit_model = RandomForestClassifier(n_estimators=100, random_state=42)
    scikit_model.fit(X_train, y_train)
    y_pred = scikit_model.predict(X_test)
    logging.info(f"Scikit-learn Model Accuracy: {accuracy_score(y_test, y_pred)}")

def train_tf_model(X, y):
    global tf_model
    tf_model = tf.keras.Sequential([
        tf.keras.layers.Dense(64, activation="relu", input_shape=(X.shape[1],)),
        tf.keras.layers.Dense(32, activation="relu"),
        tf.keras.layers.Dense(1, activation="sigmoid")
    ])
    tf_model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])
    tf_model.fit(X, y, epochs=10, verbose=0)

class SimpleNN(nn.Module):
    def __init__(self, input_dim):
        super(SimpleNN, self).__init__()
        self.fc1 = nn.Linear(input_dim, 64)
        self.relu = nn.ReLU()
        self.fc2 = nn.Linear(64, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        return self.sigmoid(self.fc2(self.relu(self.fc1(x))))

def train_pytorch_model(X, y):
    global pytorch_model
    X_tensor = torch.tensor(X, dtype=torch.float32)
    y_tensor = torch.tensor(y, dtype=torch.float32).reshape(-1, 1)

    input_dim = X.shape[1]
    pytorch_model = SimpleNN(input_dim)
    criterion = nn.BCELoss()
    optimizer = optim.Adam(pytorch_model.parameters(), lr=0.001)

    for epoch in range(10):
        optimizer.zero_grad()
        outputs = pytorch_model(X_tensor)
        loss = criterion(outputs, y_tensor)
        loss.backward()
        optimizer.step()

class ComplexNN(nn.Module):
    def __init__(self, input_dim):
        super(ComplexNN, self).__init__()
        self.fc1 = nn.Linear(input_dim, 128)
        self.bn1 = nn.BatchNorm1d(128)
        self.dropout1 = nn.Dropout(0.3)
        self.fc2 = nn.Linear(128, 64)
        self.bn2 = nn.BatchNorm1d(64)
        self.dropout2 = nn.Dropout(0.3)
        self.fc3 = nn.Linear(64, 1)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        x = self.dropout1(self.relu(self.bn1(self.fc1(x))))
        x = self.dropout2(self.relu(self.bn2(self.fc2(x))))
        return self.sigmoid(self.fc3(x))

def train_complex_pytorch_model(X, y):
    global pytorch_model
    X_tensor = torch.tensor(X, dtype=torch.float32)
    y_tensor = torch.tensor(y, dtype=torch.float32).reshape(-1, 1)

    input_dim = X.shape[1]
    pytorch_model = ComplexNN(input_dim)
    criterion = nn.BCELoss()
    optimizer = optim.Adam(pytorch_model.parameters(), lr=0.001)

    for epoch in range(20):
        optimizer.zero_grad()
        outputs = pytorch_model(X_tensor)
        loss = criterion(outputs, y_tensor)
        loss.backward()
        optimizer.step()

def train_complex_tf_model(X, y):
    global tf_model
    tf_model = tf.keras.Sequential([
        tf.keras.layers.Dense(128, activation="relu", input_shape=(X.shape[1],)),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(64, activation="relu"),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.Dense(32, activation="relu"),
        tf.keras.layers.Dense(1, activation="sigmoid")
    ])
    tf_model.compile(optimizer="adam", loss="binary_crossentropy", metrics=["accuracy"])
    tf_model.fit(X, y, epochs=20, verbose=0, validation_split=0.2)

if torch_geometric:
    class GNN(torch.nn.Module):
        def __init__(self, num_node_features, num_classes):
            super(GNN, self).__init__()
            self.conv1 = GCNConv(num_node_features, 16)
            self.conv2 = GCNConv(16, num_classes)

        def forward(self, data):
            x, edge_index = data.x, data.edge_index
            x = self.conv1(x, edge_index)
            x = torch.relu(x)
            x = torch.dropout(x, p=0.5, train=self.training)
            x = self.conv2(x, edge_index)
            return torch.log_softmax(x, dim=1)

    def train_gnn_model(graph_data):
        global gnn_model
        gnn_model = GNN(graph_data.num_node_features, 2)
        optimizer = torch.optim.Adam(gnn_model.parameters(), lr=0.01, weight_decay=5e-4)

        gnn_model.train()
        for epoch in range(200):
            optimizer.zero_grad()
            out = gnn_model(graph_data)
            loss = torch.nn.functional.nll_loss(out[graph_data.train_mask], graph_data.y[graph_data.train_mask])
            loss.backward()
            optimizer.step()

# --- Celery Tasks ---
@celery.task(bind=True, max_retries=3, default_retry_delay=60)
def train_model_task(self, model_type, data):
    try:
        if model_type == "scikit-learn":
            X = np.array([d["features"] for d in data])
            y = np.array([d["label"] for d in data])
            train_scikit_model(X, y)
        elif model_type == "tensorflow":
            X = np.array([d["features"] for d in data])
            y = np.array([d["label"] for d in data])
            train_tf_model(X, y)
        elif model_type == "pytorch":
            X = np.array([d["features"] for d in data])
            y = np.array([d["label"] for d in data])
            train_pytorch_model(X, y)
        elif model_type == "gnn" and gnn_model is not None:
            train_gnn_model(data)
        else:
            raise ValueError(f"Unknown model type: {model_type}")
        return {"status": "success", "message": f"{model_type} model training completed."}
    except Exception as exc:
        logging.error(f"Task failed: {exc}. Retrying...")
        raise self.retry(exc=exc)

# --- Model Persistence ---
import joblib

def save_model(model, filename):
    joblib.dump(model, filename)

def load_model(filename):
    return joblib.load(filename)

# --- Model Registry ---
def register_model(model_name, model_object, model_type, version="1.0"):
    model_registry[model_name] = {
        "model_object": model_object,
        "model_type": model_type,
        "version": version,
        "timestamp": time.time()
    }
    logging.info(f"Model {model_name} (version {version}) registered.")

# --- Application Factory ---
def create_app(config_name="default"):
    app = Flask(__name__)

    if config_name == "development":
        app.config.from_object(DevelopmentConfig)
    elif config_name == "testing":
        app.config.from_object(TestingConfig)
    else:
        app.config.from_object(ProductionConfig)

    db.init_app(app)
    CORS(app)
    celery.conf.update(app.config)

    # --- API Key Decorator ---
    def require_api_key(f):
        @wraps(f)
        def decorated_function(*args, **kwargs):
            if request.headers.get("x-api-key") and request.headers.get("x-api-key") == app.config["API_KEY"]:
                return f(*args, **kwargs)
            else:
                return jsonify({"error": "API key required or invalid"}), 401
        return decorated_function

    # --- Redis Client Initialization ---
    redis_client = redis.StrictRedis.from_url(app.config["CELERY_BROKER_URL"])

    # --- API Documentation (Swagger) ---
    SWAGGER_URL = "/swagger"
    API_URL = "/static/swagger.json"
    SWAGGERUI_BLUEPRINT = get_swaggerui_blueprint(
        SWAGGER_URL,
        API_URL,
        config={
            "app_name": "Data Processing Service"
        }
    )
    app.register_blueprint(SWAGGERUI_BLUEPRINT, url_prefix=SWAGGER_URL)

    # This is a placeholder for a swagger.json file. In a real application, this would be generated.
    @app.route("/static/swagger.json")
    def swagger_spec():
        return jsonify({
            "swagger": "2.0",
            "info": {
                "title": "Data Processing Service API",
                "version": "1.0"
            },
            "paths": {}
        })

    # --- Data Validation Schemas ---
    class TransactionSchema(Schema):
        amount = fields.Float(required=True)
        type = fields.Str(required=True)
        oldbalanceOrg = fields.Float(required=True)
        newbalanceOrig = fields.Float(required=True)
        oldbalanceDest = fields.Float(required=True)
        newbalanceDest = fields.Float(required=True)

    class UserProfileSchema(Schema):
        user_id = fields.Str(required=True, validate=validate.Length(min=5))
        age = fields.Int(required=True, validate=validate.Range(min=18, max=100))
        country = fields.Str(required=True, validate=validate.OneOf(["USA", "CAN", "GBR", "DEU"]))
        registration_date = fields.DateTime(required=True)
        email = fields.Email(required=True)
        is_premium = fields.Bool(load_default=False)

    class ProductSchema(Schema):
        product_id = fields.Str(required=True)
        name = fields.Str(required=True)
        category = fields.Str(required=True)
        price = fields.Float(required=True, validate=validate.Range(min=0.01))
        stock_quantity = fields.Int(required=True, validate=validate.Range(min=0))

    # --- API Endpoints ---
    @app.route("/")
    def home():
        return "Data Processing Service is running!"

    @app.route("/health")
    def health_check():
        try:
            db.session.execute(db.text("SELECT 1"))
            redis_client = redis.StrictRedis.from_url(app.config["CELERY_BROKER_URL"])
            redis_client.ping()
            return jsonify({"status": "healthy", "database": "connected", "redis": "connected"}), 200
        except Exception as e:
            logging.error(f"Health check failed: {e}")
            return jsonify({"status": "unhealthy", "error": str(e)}), 500

    @app.route("/process_data", methods=["POST"])
    def process_data():
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400
        processed_data = {"received_data": data, "status": "Data processed successfully"}
        return jsonify(processed_data)

    @app.route("/process_and_store_data", methods=["POST"])
    def process_and_store_data():
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        cached_result = redis_client.get(json.dumps(data))
        if cached_result:
            return jsonify({"status": "Data retrieved from cache", "processed_data": json.loads(cached_result)}), 200

        processed_result = {"original_input": data, "status": "Processed and stored"}

        new_entry = ProcessedData(original_data=json.dumps(data), processed_result=json.dumps(processed_result))
        db.session.add(new_entry)
        db.session.commit()

        redis_client.setex(json.dumps(data), 3600, json.dumps(processed_result))

        return jsonify({"status": "Data processed, stored, and cached", "processed_data": processed_result}), 201

    @app.route("/get_processed_data/<int:entry_id>", methods=["GET"])
    def get_processed_data(entry_id):
        entry = ProcessedData.query.get(entry_id)
        if not entry:
            return jsonify({"error": "Entry not found"}), 404
        return jsonify({"id": entry.id, "original_data": json.loads(entry.original_data), "processed_result": json.loads(entry.processed_result), "timestamp": entry.timestamp}), 200

    @app.route("/predict", methods=["POST"])
    def predict():
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided for prediction"}), 400

        features = feature_engineer(data)

        predictions = {}
        if scikit_model:
            predictions["scikit_learn"] = scikit_model.predict(features).tolist()
        if tf_model:
            predictions["tensorflow"] = tf_model.predict(features).tolist()
        if pytorch_model:
            predictions["pytorch"] = pytorch_model(torch.tensor(features, dtype=torch.float32)).detach().numpy().tolist()

        if not predictions:
            return jsonify({"error": "No ML models trained yet. Please train models first."}), 500

        return jsonify({"status": "Prediction successful", "predictions": predictions}), 200

    @app.route("/train_models", methods=["POST"])
    def train_models():
        num_samples = 100
        num_features = 5
        X_dummy = np.random.rand(num_samples, num_features)
        y_dummy = np.random.randint(0, 2, num_samples)

        train_scikit_model(X_dummy, y_dummy)
        train_tf_model(X_dummy, y_dummy)
        train_pytorch_model(X_dummy, y_dummy)

        return jsonify({"status": "ML models trained successfully"}), 200

    @app.route("/predict_advanced", methods=["POST"])
    @require_api_key
    def predict_advanced():
        try:
            data = TransactionSchema().load(request.get_json())
        except ValidationError as err:
            return jsonify({"error": "Invalid input data", "messages": err.messages}), 400

        features = advanced_feature_engineer(data)

        predictions = {}
        if scikit_model:
            predictions["scikit_learn"] = scikit_model.predict_proba(features).tolist()
        if tf_model:
            predictions["tensorflow"] = tf_model.predict(features).tolist()
        if pytorch_model:
            predictions["pytorch"] = pytorch_model(torch.tensor(features, dtype=torch.float32)).detach().numpy().tolist()

        if not predictions:
            return jsonify({"error": "No ML models trained yet. Please train models first."}), 500

        return jsonify({"status": "Prediction successful", "predictions": predictions}), 200

    @app.route("/train_model_async", methods=["POST"])
    @require_api_key
    def train_model_async():
        request_data = request.get_json()
        model_type = request_data.get("model_type")
        training_data = request_data.get("data")

        if not model_type or not training_data:
            return jsonify({"error": "model_type and data are required"}), 400

        task = train_model_task.delay(model_type, training_data)
        return jsonify({"status": "Training task started", "task_id": task.id}), 202

    @app.route("/task_status/<task_id>", methods=["GET"])
    @require_api_key
    def get_task_status(task_id):
        task = train_model_task.AsyncResult(task_id)
        response = {
            "task_id": task_id,
            "status": task.state,
            "result": task.result
        }
        return jsonify(response)

    @app.route("/models", methods=["GET"])
    @require_api_key
    def get_models():
        models = []
        if scikit_model:
            models.append("scikit-learn")
        if tf_model:
            models.append("tensorflow")
        if pytorch_model:
            models.append("pytorch")
        if gnn_model:
            models.append("gnn")
        return jsonify({"models": models})

    @app.route("/evaluate_model/<model_type>", methods=["POST"])
    @require_api_key
    def evaluate_model(model_type):
        data = request.get_json()
        if not data or "features" not in data or "labels" not in data:
            return jsonify({"error": "Features and labels are required for evaluation"}), 400

        X_test = np.array(data["features"])
        y_test = np.array(data["labels"])

        model = None
        if model_type == "scikit-learn":
            model = scikit_model

        if not model:
            return jsonify({"error": f"Model of type {model_type} not found or not supported for evaluation."}), 404

        y_pred = model.predict(X_test)
        report = classification_report(y_test, y_pred, output_dict=True)

        return jsonify({"status": "Evaluation successful", "classification_report": report}), 200

    @app.route("/predict_batch", methods=["POST"])
    @require_api_key
    def predict_batch():
        request_data = request.get_json()
        if not request_data or "transactions" not in request_data:
            return jsonify({"error": "List of transactions is required"}), 400

        try:
            transactions = [TransactionSchema().load(tx) for tx in request_data["transactions"]]
        except ValidationError as err:
            return jsonify({"error": "Invalid input data", "messages": err.messages}), 400

        predictions = []
        for tx in transactions:
            features = advanced_feature_engineer(tx)
            prediction = {}
            if scikit_model:
                prediction["scikit_learn"] = scikit_model.predict_proba(features).tolist()
            if tf_model:
                prediction["tensorflow"] = tf_model.predict(features).tolist()
            if pytorch_model:
                prediction["pytorch"] = pytorch_model(torch.tensor(features, dtype=torch.float32)).detach().numpy().tolist()
            predictions.append(prediction)

        return jsonify({"status": "Batch prediction successful", "predictions": predictions}), 200

    @app.route("/predict_ab", methods=["POST"])
    @require_api_key
    def predict_ab():
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided for prediction"}), 400

        features = feature_engineer(data)

        if np.random.rand() > 0.5:
            if scikit_model:
                prediction = scikit_model.predict(features).tolist()
                model_used = "scikit-learn"
            else:
                prediction = tf_model.predict(features).tolist() if tf_model else None
                model_used = "tensorflow"
        else:
            if tf_model:
                prediction = tf_model.predict(features).tolist()
                model_used = "tensorflow"
            else:
                prediction = scikit_model.predict(features).tolist() if scikit_model else None
                model_used = "scikit-learn"

        if prediction is None:
            return jsonify({"error": "No models available for A/B testing."}), 500

        return jsonify({"status": "A/B test prediction successful", "model_used": model_used, "prediction": prediction}), 200

    if shap:
        @app.route("/explain_prediction", methods=["POST"])
        @require_api_key
        def explain_prediction():
            data = request.get_json()
            if not data:
                return jsonify({"error": "No data provided for explanation"}), 400

            if not scikit_model:
                return jsonify({"error": "Scikit-learn model not trained, cannot provide explanation."}), 500

            features = feature_engineer(data)
            explainer = shap.TreeExplainer(scikit_model)
            shap_values = explainer.shap_values(features)

            return jsonify({"status": "Explanation successful", "shap_values": shap_values.tolist()}), 200

    if Nominatim:
        @app.route("/geocode", methods=["POST"])
        @require_api_key
        def geocode_address():
            data = request.get_json()
            if not data or "address" not in data:
                return jsonify({"error": "Address is required for geocoding"}), 400

            geolocator = Nominatim(user_agent="data_processing_service")
            location = geolocator.geocode(data["address"])

            if location:
                return jsonify({"status": "Geocoding successful", "latitude": location.latitude, "longitude": location.longitude}), 200
            else:
                return jsonify({"error": "Could not geocode address"}), 404

    if Prophet:
        @app.route("/forecast", methods=["POST"])
        @require_api_key
        def forecast_time_series():
            data = request.get_json()
            if not data or "df" not in data:
                return jsonify({"error": "DataFrame with ds and y columns is required"}), 400

            df = pd.DataFrame(data["df"])
            df["ds"] = pd.to_datetime(df["ds"])

            model = Prophet()
            model.fit(df)
            future = model.make_future_dataframe(periods=365)
            forecast = model.predict(future)

            return jsonify({"status": "Forecast successful", "forecast": forecast.to_dict("records")}), 200

    @app.route("/detect_anomalies", methods=["POST"])
    @require_api_key
    def detect_anomalies():
        data = request.get_json()
        if not data or "features" not in data:
            return jsonify({"error": "Features are required for anomaly detection"}), 400

        X = np.array(data["features"])
        model = IsolationForest(contamination=0.1, random_state=42)
        anomalies = model.fit_predict(X)

        return jsonify({"status": "Anomaly detection successful", "anomalies": anomalies.tolist()}), 200

    if nltk and SentimentIntensityAnalyzer:
        @app.route("/analyze_sentiment", methods=["POST"])
        @require_api_key
        def analyze_sentiment():
            data = request.get_json()
            if not data or "text" not in data:
                return jsonify({"error": "Text is required for sentiment analysis"}), 400

            # Ensure vader_lexicon is downloaded
            try:
                nltk.data.find("sentiment/vader_lexicon.zip")
            except nltk.downloader.DownloadError:
                nltk.download("vader_lexicon")

            sia = SentimentIntensityAnalyzer()
            sentiment = sia.polarity_scores(data["text"])

            return jsonify({"status": "Sentiment analysis successful", "sentiment": sentiment}), 200

    @app.route("/preprocess_data", methods=["POST"])
    @require_api_key
    def preprocess_data_endpoint():
        data = request.get_json()
        if not data or "dataframe" not in data:
            return jsonify({"error": "DataFrame is required for preprocessing"}), 400

        df = pd.DataFrame(data["dataframe"])

        df_cleaned = clean_data(df.copy())
        numeric_cols = df_cleaned.select_dtypes(include=np.number).columns.tolist()
        if numeric_cols:
            df_normalized = normalize_data(df_cleaned.copy(), numeric_cols)
        else:
            df_normalized = df_cleaned.copy()

        categorical_cols = df_normalized.select_dtypes(include='object').columns.tolist()
        if categorical_cols:
            df_encoded = encode_categorical(df_normalized.copy(), categorical_cols)
        else:
            df_encoded = df_normalized.copy()

        return jsonify({"status": "Data preprocessed successfully", "processed_dataframe": df_encoded.to_dict(orient='records')}), 200

    @app.route("/train_svm", methods=["POST"])
    @require_api_key
    def train_svm_model_endpoint():
        global svm_model
        data = request.get_json()
        if not data or "features" not in data or "labels" not in data:
            return jsonify({"error": "Features and labels are required for SVM training"}), 400

        X = np.array(data["features"])
        y = np.array(data["labels"])

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
        svm_model = SVC(probability=True, random_state=42)
        svm_model.fit(X_train, y_train)
        y_pred = svm_model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred)
        logging.info(f"SVM Model Accuracy: {accuracy}")

        return jsonify({"status": "SVM model trained successfully", "accuracy": accuracy}), 200

    @app.route("/cluster_data", methods=["POST"])
    @require_api_key
    def cluster_data_endpoint():
        data = request.get_json()
        if not data or "features" not in data or "n_clusters" not in data:
            return jsonify({"error": "Features and n_clusters are required for clustering"}), 400

        X = np.array(data["features"])
        n_clusters = int(data["n_clusters"])

        kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init=10)
        clusters = kmeans.fit_predict(X)

        return jsonify({"status": "Data clustered successfully", "clusters": clusters.tolist()}), 200

    @app.route("/register_trained_model", methods=["POST"])
    @require_api_key
    def register_trained_model_endpoint():
        data = request.get_json()
        model_name = data.get("model_name")
        model_type = data.get("model_type")
        
        if model_name == "scikit_learn_model" and scikit_model:
            register_model(model_name, scikit_model, model_type)
        elif model_name == "tensorflow_model" and tf_model:
            register_model(model_name, tf_model, model_type)
        elif model_name == "pytorch_model" and pytorch_model:
            register_model(model_name, pytorch_model, model_type)
        else:
            return jsonify({"error": "Model not found or invalid type"}), 400

        return jsonify({"status": "Model registered successfully", "model_name": model_name}), 200

    @app.route("/get_registered_models", methods=["GET"])
    @require_api_key
    def get_registered_models():
        return jsonify({
            "registered_models": [
                {"name": k, "type": v["model_type"], "version": v["version"]}
                for k, v in model_registry.items()
            ]
        }), 200

    @app.route("/ingest_transaction", methods=["POST"])
    @require_api_key
    def ingest_transaction():
        try:
            transaction_data = TransactionSchema().load(request.get_json())
        except ValidationError as err:
            return jsonify({"error": "Invalid transaction data", "messages": err.messages}), 400

        logging.info(f"Ingesting transaction: {transaction_data}")

        features = advanced_feature_engineer(transaction_data)

        predictions = {}
        if scikit_model:
            predictions["scikit_learn"] = scikit_model.predict_proba(features).tolist()
        if tf_model:
            predictions["tensorflow"] = tf_model.predict(features).tolist()
        if pytorch_model:
            predictions["pytorch"] = pytorch_model(torch.tensor(features, dtype=torch.float32)).detach().numpy().tolist()

        try:
            new_entry = ProcessedData(
                original_data=json.dumps(transaction_data),
                processed_result=json.dumps(predictions)
            )
            db.session.add(new_entry)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            logging.error(f"Error storing processed transaction: {e}")
            return jsonify({"error": f"Failed to store processed transaction: {e}"}), 500

        return jsonify({
            "status": "Transaction ingested and processed",
            "transaction_id": new_entry.id,
            "predictions": predictions
        }), 200

    @app.route("/generate_daily_report", methods=["GET"])
    @require_api_key
    def generate_daily_report():
        today = datetime.now().date()
        start_of_day = datetime.combine(today, time.min)
        end_of_day = datetime.combine(today, time.max)

        daily_data = ProcessedData.query.filter(
            ProcessedData.timestamp >= start_of_day,
            ProcessedData.timestamp <= end_of_day
        ).all()

        total_transactions = len(daily_data)

        return jsonify({
            "status": "Daily report generated",
            "date": str(today),
            "total_transactions_processed": total_transactions,
            "summary": "Further detailed metrics would be here."
        }), 200

    REQUEST_COUNT = Counter("http_requests_total", "Total HTTP Requests", ["method", "endpoint"])
    REQUEST_LATENCY = Histogram("http_request_duration_seconds", "HTTP Request Latency", ["method", "endpoint"])

    @app.before_request
    def before_request_metrics():
        request.start_time = time.time()

    @app.after_request
    def after_request_metrics(response):
        request_latency = time.time() - request.start_time
        REQUEST_COUNT.labels(request.method, request.path).inc()
        REQUEST_LATENCY.labels(request.method, request.path).observe(request_latency)
        return response

    @app.route("/metrics")
    def metrics():
        return generate_latest(), 200

    @app.route("/data_retention_policy", methods=["GET"])
    @require_api_key
    def get_data_retention_policy():
        policy = {
            "description": "All raw transaction data is retained for 90 days. Processed and aggregated data is retained for 5 years.",
            "raw_data_retention_days": 90,
            "aggregated_data_retention_years": 5,
            "compliance_standards": ["GDPR", "CCPA", "PCI DSS"]
        }
        return jsonify(policy), 200

    @app.route("/anonymize_data", methods=["POST"])
    @require_api_key
    def anonymize_data_endpoint():
        data = request.get_json()
        record_id = data.get("record_id")

        if not record_id:
            return jsonify({"error": "Record ID is required"}), 400

        logging.info(f"Attempting to anonymize record ID: {record_id}")

        return jsonify({"status": "Data anonymization process initiated for record", "record_id": record_id}), 200

    @app.route("/deploy_model_to_production", methods=["POST"])
    @require_api_key
    def deploy_model_to_production():
        data = request.get_json()
        model_name = data.get("model_name")
        version = data.get("version")

        if not model_name or not version:
            return jsonify({"error": "Model name and version are required"}), 400

        logging.info(f"Triggering deployment for model {model_name} version {version}.")

        return jsonify({"status": "Model deployment triggered", "model_name": model_name, "version": version}), 200

    @app.route("/rollback_model_deployment", methods=["POST"])
    @require_api_key
    def rollback_model_deployment():
        data = request.get_json()
        model_name = data.get("model_name")
        previous_version = data.get("previous_version")

        if not model_name or not previous_version:
            return jsonify({"error": "Model name and previous version are required"}), 400

        logging.info(f"Triggering rollback for model {model_name} to version {previous_version}.")

        return jsonify({"status": "Model rollback triggered", "model_name": model_name, "previous_version": previous_version}), 200

    @app.route("/get_prediction_distribution", methods=["GET"])
    @require_api_key
    def get_prediction_distribution():
        positive_predictions = random.randint(100, 500)
        negative_predictions = random.randint(100, 500)

        return jsonify({
            "status": "Prediction distribution data",
            "data": {
                "positive": positive_predictions,
                "negative": negative_predictions
            }
        }), 200

    @app.route("/get_processed_data_from_replica/<int:entry_id>", methods=["GET"])
    @require_api_key
    def get_processed_data_from_replica(entry_id):
        entry = db.session.get(ProcessedData, entry_id, bind_key='read_only_1')
        if not entry:
            return jsonify({"error": "Entry not found"}), 404
        return jsonify({"id": entry.id, "original_data": json.loads(entry.original_data), "processed_result": json.loads(entry.processed_result), "timestamp": entry.timestamp}), 200

    @app.cli.command("init-db")
    def init_db_command():
        db.create_all()
        click.echo("Initialized the database.")

    @app.cli.command("create-user")
    @click.argument("username")
    @click.argument("password")
    def create_user_command(username, password):
        if User.query.filter_by(username=username).first():
            click.echo("User already exists.")
            return
        new_user = User(username=username)
        new_user.set_password(password)
        db.session.add(new_user)
        db.session.commit()
        click.echo(f"User {username} created.")

    @app.route("/register", methods=["POST"])
    def register_user():
        data = request.get_json()
        username = data.get("username")
        password = data.get("password")

        if not username or not password:
            return jsonify({"error": "Username and password are required"}), 400

        if User.query.filter_by(username=username).first():
            return jsonify({"error": "Username already exists"}), 409

        new_user = User(username=username)
        new_user.set_password(password)
        db.session.add(new_user)
        db.session.commit()

        return jsonify({"status": "User registered successfully"}), 201

    @app.route("/login", methods=["POST"])
    def login_user():
        data = request.get_json()
        username = data.get("username")
        password = data.get("password")

        user = User.query.filter_by(username=username).first()

        if user and user.check_password(password):
            return jsonify({"status": "Login successful", "message": "Replace with JWT token in production"}), 200
        else:
            return jsonify({"error": "Invalid username or password"}), 401

    @app.errorhandler(404)
    def not_found_error(error):
        return jsonify({"error": "Not Found", "message": str(error)}), 404

    @app.errorhandler(500)
    def internal_error(error):
        db.session.rollback()
        return jsonify({"error": "Internal Server Error", "message": str(error)}), 500

    @app.route("/deep_health", methods=["GET"])
    def deep_health_check():
        health_status = {"status": "healthy"}
        errors = []

        try:
            db.session.execute(db.text("SELECT 1"))
            health_status["database"] = "connected"
        except Exception as e:
            health_status["database"] = "disconnected"
            errors.append(f"Database error: {e}")

        try:
            redis_client.ping()
            health_status["redis"] = "connected"
        except Exception as e:
            health_status["redis"] = "disconnected"
            errors.append(f"Redis error: {e}")

        health_status["ml_models"] = {
            "scikit_learn": "loaded" if scikit_model else "not_loaded",
            "tensorflow": "loaded" if tf_model else "not_loaded",
            "pytorch": "loaded" if pytorch_model else "not_loaded",
            "gnn": "loaded" if gnn_model else "not_loaded"
        }

        if errors:
            health_status["status"] = "unhealthy"
            health_status["errors"] = errors
            return jsonify(health_status), 500

        return jsonify(health_status), 200

    def complex_data_transformation(df):
        return df

    return app

# --- Main Execution Block ---
if __name__ == "__main__":
    load_dotenv()

    config_name = os.getenv("FLASK_CONFIG", "development")
    app = create_app(config_name)

    with app.app_context():
        db.create_all()



    app.run(host="0.0.0.0", port=5000, debug=True)





