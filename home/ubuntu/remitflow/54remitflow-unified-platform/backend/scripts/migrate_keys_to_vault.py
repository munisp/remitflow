"""
Vault Key Migration Script
Migrates blockchain private keys and other sensitive secrets from environment
variables into HashiCorp Vault Transit engine.

Run once during initial production setup:
    VAULT_ADDR=http://vault:8200 VAULT_TOKEN=<root_token> python3 migrate_keys_to_vault.py

After migration, remove BLOCKCHAIN_PRIVATE_KEY from .env and all containers.
Keys are then loaded at runtime via load_key_from_vault().
"""
import os
import sys
import json
import base64
import logging
import hvac  # pip install hvac

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

VAULT_ADDR = os.getenv("VAULT_ADDR", "http://vault:8200")
VAULT_TOKEN = os.getenv("VAULT_TOKEN")
VAULT_TRANSIT_PATH = os.getenv("VAULT_TRANSIT_PATH", "transit")
VAULT_KV_PATH = os.getenv("VAULT_KV_PATH", "secret/remitflow")

# Keys to migrate from env vars to Vault KV
ENV_KEYS_TO_MIGRATE = [
    "BLOCKCHAIN_PRIVATE_KEY",
    "JWT_SECRET_KEY",
    "ENCRYPTION_KEY",
    "STRIPE_API_KEY",
    "PAYSTACK_SECRET_KEY",
    "FLUTTERWAVE_SECRET_KEY",
    "WISE_API_KEY",
    "CIRCLE_API_KEY",
    "CIRCLE_ENTITY_SECRET",
    "TWILIO_AUTH_TOKEN",
    "SENDGRID_API_KEY",
    "FIREBASE_SERVER_KEY",
    "AFRICAS_TALKING_API_KEY",
    "SMILE_ID_API_KEY",
    "AWS_SECRET_ACCESS_KEY",
    "NIBSS_SECRET_KEY",
]


def get_vault_client() -> hvac.Client:
    if not VAULT_TOKEN:
        raise ValueError("VAULT_TOKEN environment variable is required")
    client = hvac.Client(url=VAULT_ADDR, token=VAULT_TOKEN)
    if not client.is_authenticated():
        raise ValueError(f"Vault authentication failed at {VAULT_ADDR}")
    logger.info(f"Connected to Vault at {VAULT_ADDR}")
    return client


def enable_transit_engine(client: hvac.Client) -> None:
    """Enable the Transit secrets engine if not already enabled."""
    try:
        mounts = client.sys.list_mounted_secrets_engines()
        if f"{VAULT_TRANSIT_PATH}/" not in mounts:
            client.sys.enable_secrets_engine(
                backend_type="transit",
                path=VAULT_TRANSIT_PATH,
            )
            logger.info(f"Enabled Transit engine at {VAULT_TRANSIT_PATH}/")
        else:
            logger.info(f"Transit engine already enabled at {VAULT_TRANSIT_PATH}/")
    except Exception as e:
        logger.error(f"Failed to enable Transit engine: {e}")
        raise


def create_transit_key(client: hvac.Client, key_name: str = "remitflow-blockchain") -> None:
    """Create an AES-256-GCM96 encryption key for wrapping blockchain private keys."""
    try:
        client.secrets.transit.create_key(
            name=key_name,
            mount_point=VAULT_TRANSIT_PATH,
            key_type="aes256-gcm96",
            exportable=False,
            allow_plaintext_backup=False,
        )
        logger.info(f"Created Transit key: {key_name}")
    except Exception as e:
        if "already exists" in str(e).lower():
            logger.info(f"Transit key {key_name} already exists")
        else:
            raise


def migrate_keys_to_kv(client: hvac.Client) -> dict:
    """Migrate all sensitive env vars to Vault KV store."""
    migrated = {}
    missing = []

    for key in ENV_KEYS_TO_MIGRATE:
        value = os.getenv(key)
        if not value:
            missing.append(key)
            continue

        try:
            client.secrets.kv.v2.create_or_update_secret(
                path=f"platform/{key.lower()}",
                secret={"value": value},
                mount_point="secret",
            )
            migrated[key] = "migrated"
            logger.info(f"Migrated {key} to Vault KV")
        except Exception as e:
            logger.error(f"Failed to migrate {key}: {e}")
            migrated[key] = f"error: {e}"

    if missing:
        logger.warning(f"Keys not found in environment (skipped): {missing}")

    return migrated


def wrap_blockchain_key(client: hvac.Client, private_key: str, key_name: str = "remitflow-blockchain") -> str:
    """
    Encrypt a blockchain private key using Vault Transit.
    Returns the ciphertext to store in the database or config.
    """
    plaintext_b64 = base64.b64encode(private_key.encode()).decode()
    result = client.secrets.transit.encrypt_data(
        name=key_name,
        mount_point=VAULT_TRANSIT_PATH,
        plaintext=plaintext_b64,
    )
    ciphertext = result["data"]["ciphertext"]
    logger.info(f"Blockchain private key encrypted with Transit key {key_name}")
    return ciphertext


def load_key_from_vault(key_name: str, path_suffix: str = None) -> str:
    """
    Load a secret from Vault at runtime.
    Used by services to fetch API keys without env vars.

    Example:
        wise_key = load_key_from_vault("WISE_API_KEY")
    """
    vault_addr = os.getenv("VAULT_ADDR", "http://vault:8200")
    vault_token = os.getenv("VAULT_TOKEN")

    if not vault_token:
        # Fall back to env var if Vault not available
        value = os.getenv(key_name)
        if value:
            return value
        raise ValueError(f"Key {key_name} not found in Vault or environment")

    client = hvac.Client(url=vault_addr, token=vault_token)
    path = path_suffix or f"platform/{key_name.lower()}"

    try:
        secret = client.secrets.kv.v2.read_secret_version(
            path=path,
            mount_point="secret",
        )
        return secret["data"]["data"]["value"]
    except Exception as e:
        # Graceful fallback to env var
        value = os.getenv(key_name)
        if value:
            logger.warning(f"Vault read failed for {key_name}, using env var fallback: {e}")
            return value
        raise ValueError(f"Key {key_name} not found in Vault ({e}) or environment")


def decrypt_blockchain_key(client: hvac.Client, ciphertext: str, key_name: str = "remitflow-blockchain") -> str:
    """Decrypt a blockchain private key using Vault Transit."""
    result = client.secrets.transit.decrypt_data(
        name=key_name,
        mount_point=VAULT_TRANSIT_PATH,
        ciphertext=ciphertext,
    )
    plaintext_b64 = result["data"]["plaintext"]
    return base64.b64decode(plaintext_b64).decode()


if __name__ == "__main__":
    logger.info("=== RemitFlow Vault Key Migration ===")

    try:
        client = get_vault_client()
    except Exception as e:
        logger.error(f"Cannot connect to Vault: {e}")
        sys.exit(1)

    # 1. Enable Transit engine
    enable_transit_engine(client)

    # 2. Create Transit encryption key
    create_transit_key(client)

    # 3. Migrate all env var secrets to KV
    results = migrate_keys_to_kv(client)

    # 4. Wrap blockchain private key with Transit
    blockchain_key = os.getenv("BLOCKCHAIN_PRIVATE_KEY")
    if blockchain_key:
        ciphertext = wrap_blockchain_key(client, blockchain_key)
        logger.info(f"Blockchain key ciphertext (store this in config):\n{ciphertext}")
        # Store the ciphertext in Vault KV as well
        client.secrets.kv.v2.create_or_update_secret(
            path="platform/blockchain_private_key_ciphertext",
            secret={"ciphertext": ciphertext, "transit_key": "remitflow-blockchain"},
            mount_point="secret",
        )

    logger.info("=== Migration Summary ===")
    for key, status in results.items():
        logger.info(f"  {key}: {status}")

    logger.info("\nMigration complete. Remove sensitive env vars from .env and docker-compose.yml")
    logger.info("Services should now call load_key_from_vault() to retrieve secrets at runtime.")
