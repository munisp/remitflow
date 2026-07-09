import os

from dotenv import load_dotenv

load_dotenv()


class Config:
    """Base config"""

    AUDIT_SVC_URL = os.getenv("AUDIT_SVC_URL", "http://audit-service:8000")
    DATABASE_URI = os.getenv("DATABASE_URI", "")
    KEYCLOAK_BASE_URL = os.getenv("KEYCLOAK_BASE_URL", "")
    KEYCLOAK_ADMIN_USERNAME = os.getenv("KEYCLOAK_ADMIN_USERNAME", "")
    KEYCLOAK_ADMIN_PASSWORD = os.getenv("KEYCLOAK_ADMIN_PASSWORD", "")
    ROOT_PATH = os.getenv("ROOT_PATH", "/")
    DAPR_PUBSUB_NAME = os.getenv("DAPR_PUBSUB_NAME", "pubsub")
    DEFAULT_KEYCLOAK_REALM = os.getenv("DEFAULT_KEYCLOAK_REALM", "")
    DEFAULT_KEYCLOAK_PUBLIC_KEY = os.getenv("DEFAULT_KEYCLOAK_PUBLIC_KEY", "")
    DEFAULT_TENANT_ID = os.getenv("DEFAULT_TENANT_ID", "54remit")
    DEFAULT_SUPER_ADMIN_NAME = os.getenv("DEFAULT_SUPER_ADMIN_NAME", "")
    DEFAULT_SUPER_ADMIN_EMAIL = os.getenv("DEFAULT_SUPER_ADMIN_EMAIL", "")
    DEFAULT_SUPER_ADMIN_PASSWORD = os.getenv("DEFAULT_SUPER_ADMIN_PASSWORD", "")
    KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
    KAFKA_SECURITY_PROTOCOL = os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT")
    KAFKA_SASL_MECHANISM = os.getenv("KAFKA_SASL_MECHANISM", "")
    KAFKA_SASL_USERNAME = os.getenv("KAFKA_SASL_USERNAME", "")
    KAFKA_SASL_PASSWORD = os.getenv("KAFKA_SASL_PASSWORD", "")

    # VPN/Tor/datacenter blocking on login
    BLOCK_VPN = os.getenv("BLOCK_VPN", "true").lower() == "true"
    BLOCK_TOR = os.getenv("BLOCK_TOR", "true").lower() == "true"
    BLOCK_DATACENTER = os.getenv("BLOCK_DATACENTER", "false").lower() == "true"

    # Permify (ReBAC authorization)
    PERMIFY_URL = os.getenv("PERMIFY_URL", "http://localhost:3476")
    PERMIFY_DEFAULT_TENANT = os.getenv("PERMIFY_DEFAULT_TENANT", "54remit")
    PERMIFY_WRITE_ATTEMPTS = int(os.getenv("PERMIFY_WRITE_ATTEMPTS", "15"))

    # OTP (Redis-backed)
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

    # Base URL for calling out to user-service/admin-service (e.g. account
    # suspension on repeated failed logins). Configure per environment —
    # never hardcode a real hostname here.
    INTERNAL_API_BASE_URL = os.getenv("INTERNAL_API_BASE_URL", "")


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False


config = {"development": DevelopmentConfig, "production": ProductionConfig}

config_name = os.getenv("APP_ENV", "development")


def get_config() -> Config:
    config_data = config.get(config_name)

    if config_data is None:
        raise Exception("Config {} not found".format(config_name))

    return config_data
