import os
import sys
import redis
import logging
from prometheus_flask_exporter import PrometheusMetrics
from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS
from src.models.user import db, User
from src.models.recommendation import Recommendation
from src.models.item import Item
from src.routes.user import user_bp
from src.routes.recommendation import recommendation_bp
from src.config import config

# DON'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# Initialize Flask app
app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), "static"))

# Load configuration
app_config = config[os.environ.get("FLASK_ENV", "default")]
app.config.from_object(app_config)

# Configure logging
logging.basicConfig(level=getattr(logging, app_config.LOGGING_LEVEL))
logger = logging.getLogger(__name__)

# Enable CORS
CORS(app)

# Initialize Redis
try:
    redis_client = redis.from_url(app.config["REDIS_URL"])
    redis_client.ping()
    logger.info("Successfully connected to Redis.")
except redis.exceptions.ConnectionError as e:
    logger.error(f"Could not connect to Redis: {e}. Caching will be unavailable.")
    redis_client = None # Set to None if connection fails

# Initialize Prometheus Metrics
metrics = PrometheusMetrics(app)

# Register blueprints
app.register_blueprint(user_bp, url_prefix="/api")
app.register_blueprint(recommendation_bp, url_prefix="/api")

# Initialize SQLAlchemy DB
db.init_app(app)
with app.app_context():
    db.create_all()
    logger.info("Database initialized and models created.")

# Error handling
@app.errorhandler(404)
def not_found_error(error):
    logger.warning(f"404 Not Found: {request.url}")
    return jsonify({"error": "Not found", "message": "The requested URL was not found on the server."}), 404

@app.errorhandler(500)
def internal_error(error):
    db.session.rollback()
    logger.exception("500 Internal Server Error:")
    return jsonify({"error": "Internal Server Error", "message": "An unexpected error occurred."}), 500

# Serve static files and index.html
@app.route("/", defaults={'path': ''}) # type: ignore
@app.route("/<path:path>")
def serve(path):
    static_folder_path = app.static_folder
    if static_folder_path is None:
            logger.error("Static folder not configured.")
            return "Static folder not configured", 404

    if path != "" and os.path.exists(os.path.join(static_folder_path, path)):
        return send_from_directory(static_folder_path, path)
    else:
        index_path = os.path.join(static_folder_path, "index.html")
        if os.path.exists(index_path):
            return send_from_directory(static_folder_path, "index.html")
        else:
            logger.error("index.html not found in static folder.")
            return "index.html not found", 404


if __name__ == "__main__":
    logger.info(f"Starting Flask application in {app_config.LOGGING_LEVEL} mode.")
    app.run(host="0.0.0.0", port=5000, debug=app_config.DEBUG)


