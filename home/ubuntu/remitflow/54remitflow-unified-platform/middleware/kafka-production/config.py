from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    # Database Settings
    DATABASE_URL: str = Field(
        default="sqlite:///./kafka_production.db",
        description="The SQLAlchemy database connection URL."
    )

    # Kafka Settings
    KAFKA_BOOTSTRAP_SERVERS: str = Field(
        default="localhost:9092",
        description="Comma-separated list of Kafka bootstrap servers."
    )
    KAFKA_CLIENT_ID: str = Field(
        default="fastapi-kafka-producer",
        description="Client ID for the Kafka producer."
    )
    KAFKA_ACKS: str = Field(
        default="all",
        description="The number of acknowledgments the producer requires."
    )
    KAFKA_TIMEOUT_MS: int = Field(
        default=10000,
        description="Timeout for the Kafka request in milliseconds."
    )

    # Application Settings
    SERVICE_NAME: str = "KafkaProductionService"
    LOG_LEVEL: str = "INFO"
    DEBUG: bool = False

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()