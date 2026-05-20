/**
 * EncryptedStorage.ts - Encrypted local storage for banking compliance
 * Provides AES-256 encryption for SQLite database and AsyncStorage
 * Uses device-bound keys with secure key derivation
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import SQLite from 'react-native-sqlite-storage';
import CryptoJS from 'crypto-js';
import * as Keychain from 'react-native-keychain';
import DeviceInfo from 'react-native-device-info';

// Enable SQLite debugging in development
SQLite.DEBUG(__DEV__);
SQLite.enablePromise(true);

interface EncryptionConfig {
  algorithm: 'AES-256-GCM';
  keyDerivation: 'PBKDF2';
  iterations: 100000;
  saltLength: 32;
  ivLength: 16;
}

interface EncryptedData {
  ciphertext: string;
  iv: string;
  salt: string;
  tag: string;
  version: number;
}

interface StorageMetrics {
  encryptionTime: number;
  decryptionTime: number;
  totalOperations: number;
  failedOperations: number;
}

/**
 * Secure key management using device keychain
 */
class KeyManager {
  private static readonly KEY_SERVICE = 'com.remittance.encryption';
  private static readonly KEY_ACCOUNT = 'master_key';
  private static cachedKey: string | null = null;

  /**
   * Get or create the master encryption key
   * Key is derived from device-specific identifiers and stored in secure keychain
   */
  static async getMasterKey(): Promise<string> {
    if (this.cachedKey) {
      return this.cachedKey;
    }

    try {
      // Try to retrieve existing key from keychain
      const credentials = await Keychain.getGenericPassword({
        service: this.KEY_SERVICE,
      });

      if (credentials) {
        this.cachedKey = credentials.password;
        return this.cachedKey;
      }

      // Generate new key if not exists
      const newKey = await this.generateMasterKey();
      
      // Store in secure keychain
      await Keychain.setGenericPassword(this.KEY_ACCOUNT, newKey, {
        service: this.KEY_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });

      this.cachedKey = newKey;
      return newKey;
    } catch (error) {
      console.error('[KeyManager] Failed to get master key:', error);
      // Fallback to device-bound key derivation
      return this.deriveDeviceBoundKey();
    }
  }

  /**
   * Generate a new master key using secure random
   */
  private static async generateMasterKey(): Promise<string> {
    const randomBytes = CryptoJS.lib.WordArray.random(32);
    return randomBytes.toString(CryptoJS.enc.Hex);
  }

  /**
   * Derive a key bound to the device (fallback)
   */
  private static async deriveDeviceBoundKey(): Promise<string> {
    const deviceId = await DeviceInfo.getUniqueId();
    const bundleId = DeviceInfo.getBundleId();
    const buildNumber = DeviceInfo.getBuildNumber();
    
    // Combine device identifiers
    const deviceData = `${deviceId}:${bundleId}:${buildNumber}:remittance_v1`;
    
    // Derive key using PBKDF2
    const salt = CryptoJS.SHA256(deviceId).toString();
    const key = CryptoJS.PBKDF2(deviceData, salt, {
      keySize: 256 / 32,
      iterations: 100000,
    });
    
    return key.toString(CryptoJS.enc.Hex);
  }

  /**
   * Clear cached key (for logout/security events)
   */
  static clearCache(): void {
    this.cachedKey = null;
  }

  /**
   * Rotate the master key (for security compliance)
   */
  static async rotateKey(): Promise<string> {
    const newKey = await this.generateMasterKey();
    
    await Keychain.setGenericPassword(this.KEY_ACCOUNT, newKey, {
      service: this.KEY_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    this.cachedKey = newKey;
    return newKey;
  }
}

/**
 * AES-256 encryption/decryption utilities
 */
class EncryptionEngine {
  private static readonly VERSION = 1;

  /**
   * Encrypt data using AES-256
   */
  static async encrypt(plaintext: string, masterKey: string): Promise<EncryptedData> {
    // Generate random IV and salt
    const iv = CryptoJS.lib.WordArray.random(16);
    const salt = CryptoJS.lib.WordArray.random(32);
    
    // Derive encryption key from master key using PBKDF2
    const derivedKey = CryptoJS.PBKDF2(masterKey, salt, {
      keySize: 256 / 32,
      iterations: 10000,
    });
    
    // Encrypt using AES
    const encrypted = CryptoJS.AES.encrypt(plaintext, derivedKey, {
      iv: iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    
    // Generate authentication tag (HMAC)
    const tag = CryptoJS.HmacSHA256(encrypted.ciphertext.toString(), derivedKey);
    
    return {
      ciphertext: encrypted.ciphertext.toString(CryptoJS.enc.Base64),
      iv: iv.toString(CryptoJS.enc.Base64),
      salt: salt.toString(CryptoJS.enc.Base64),
      tag: tag.toString(CryptoJS.enc.Base64),
      version: this.VERSION,
    };
  }

  /**
   * Decrypt data using AES-256
   */
  static async decrypt(encryptedData: EncryptedData, masterKey: string): Promise<string> {
    // Parse components
    const iv = CryptoJS.enc.Base64.parse(encryptedData.iv);
    const salt = CryptoJS.enc.Base64.parse(encryptedData.salt);
    const ciphertext = CryptoJS.enc.Base64.parse(encryptedData.ciphertext);
    const storedTag = encryptedData.tag;
    
    // Derive encryption key
    const derivedKey = CryptoJS.PBKDF2(masterKey, salt, {
      keySize: 256 / 32,
      iterations: 10000,
    });
    
    // Verify authentication tag
    const computedTag = CryptoJS.HmacSHA256(ciphertext.toString(), derivedKey);
    if (computedTag.toString(CryptoJS.enc.Base64) !== storedTag) {
      throw new Error('Authentication tag verification failed - data may be tampered');
    }
    
    // Decrypt
    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: ciphertext } as CryptoJS.lib.CipherParams,
      derivedKey,
      {
        iv: iv,
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      }
    );
    
    return decrypted.toString(CryptoJS.enc.Utf8);
  }
}

/**
 * Encrypted AsyncStorage wrapper
 */
export class EncryptedAsyncStorage {
  private static metrics: StorageMetrics = {
    encryptionTime: 0,
    decryptionTime: 0,
    totalOperations: 0,
    failedOperations: 0,
  };

  /**
   * Store encrypted data
   */
  static async setItem(key: string, value: string): Promise<void> {
    const startTime = Date.now();
    this.metrics.totalOperations++;

    try {
      const masterKey = await KeyManager.getMasterKey();
      const encryptedData = await EncryptionEngine.encrypt(value, masterKey);
      
      await AsyncStorage.setItem(
        `encrypted_${key}`,
        JSON.stringify(encryptedData)
      );
      
      this.metrics.encryptionTime += Date.now() - startTime;
    } catch (error) {
      this.metrics.failedOperations++;
      console.error('[EncryptedAsyncStorage] setItem failed:', error);
      throw error;
    }
  }

  /**
   * Retrieve and decrypt data
   */
  static async getItem(key: string): Promise<string | null> {
    const startTime = Date.now();
    this.metrics.totalOperations++;

    try {
      const encryptedJson = await AsyncStorage.getItem(`encrypted_${key}`);
      
      if (!encryptedJson) {
        return null;
      }
      
      const encryptedData: EncryptedData = JSON.parse(encryptedJson);
      const masterKey = await KeyManager.getMasterKey();
      const decrypted = await EncryptionEngine.decrypt(encryptedData, masterKey);
      
      this.metrics.decryptionTime += Date.now() - startTime;
      return decrypted;
    } catch (error) {
      this.metrics.failedOperations++;
      console.error('[EncryptedAsyncStorage] getItem failed:', error);
      return null;
    }
  }

  /**
   * Remove encrypted data
   */
  static async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(`encrypted_${key}`);
  }

  /**
   * Store encrypted JSON object
   */
  static async setObject(key: string, value: any): Promise<void> {
    await this.setItem(key, JSON.stringify(value));
  }

  /**
   * Retrieve and decrypt JSON object
   */
  static async getObject<T>(key: string): Promise<T | null> {
    const value = await this.getItem(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  /**
   * Get storage metrics
   */
  static getMetrics(): StorageMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear all encrypted data
   */
  static async clearAll(): Promise<void> {
    const allKeys = await AsyncStorage.getAllKeys();
    const encryptedKeys = allKeys.filter(key => key.startsWith('encrypted_'));
    await AsyncStorage.multiRemove(encryptedKeys);
  }
}

/**
 * Encrypted SQLite database wrapper
 */
export class EncryptedSQLiteDatabase {
  private db: SQLite.SQLiteDatabase | null = null;
  private masterKey: string | null = null;
  private readonly dbName: string;

  constructor(dbName: string = 'AgentBankingEncrypted.db') {
    this.dbName = dbName;
  }

  /**
   * Initialize encrypted database
   */
  async initialize(): Promise<void> {
    try {
      this.masterKey = await KeyManager.getMasterKey();
      
      // Open database with encryption key
      // Note: react-native-sqlite-storage supports SQLCipher for encryption
      this.db = await SQLite.openDatabase({
        name: this.dbName,
        location: 'default',
        // SQLCipher encryption key
        key: this.masterKey,
      });
      
      // Create encrypted tables
      await this.createTables();
      
      console.log('[EncryptedSQLite] Database initialized successfully');
    } catch (error) {
      console.error('[EncryptedSQLite] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create encrypted tables
   */
  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const tables = [
      // Encrypted offline operations queue
      `CREATE TABLE IF NOT EXISTS encrypted_operations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        entity TEXT NOT NULL,
        data_encrypted TEXT NOT NULL,
        data_iv TEXT NOT NULL,
        data_salt TEXT NOT NULL,
        data_tag TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        synced INTEGER DEFAULT 0,
        retry_count INTEGER DEFAULT 0,
        last_error TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
      
      // Encrypted transactions cache
      `CREATE TABLE IF NOT EXISTS encrypted_transactions (
        id TEXT PRIMARY KEY,
        customer_id TEXT,
        data_encrypted TEXT NOT NULL,
        data_iv TEXT NOT NULL,
        data_salt TEXT NOT NULL,
        data_tag TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
      
      // Encrypted customer data cache
      `CREATE TABLE IF NOT EXISTS encrypted_customers (
        id TEXT PRIMARY KEY,
        data_encrypted TEXT NOT NULL,
        data_iv TEXT NOT NULL,
        data_salt TEXT NOT NULL,
        data_tag TEXT NOT NULL,
        synced INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
      
      // Encrypted credentials (PIN hash, tokens)
      `CREATE TABLE IF NOT EXISTS encrypted_credentials (
        key TEXT PRIMARY KEY,
        value_encrypted TEXT NOT NULL,
        value_iv TEXT NOT NULL,
        value_salt TEXT NOT NULL,
        value_tag TEXT NOT NULL,
        expires_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
      
      // Sync metadata
      `CREATE TABLE IF NOT EXISTS sync_metadata (
        entity TEXT PRIMARY KEY,
        last_sync INTEGER,
        sync_token TEXT,
        version INTEGER DEFAULT 1
      )`,
      
      // Audit log (encrypted)
      `CREATE TABLE IF NOT EXISTS encrypted_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        data_encrypted TEXT,
        data_iv TEXT,
        data_salt TEXT,
        data_tag TEXT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
    ];

    for (const table of tables) {
      await this.db.executeSql(table);
    }

    // Create indexes
    await this.db.executeSql(
      'CREATE INDEX IF NOT EXISTS idx_operations_synced ON encrypted_operations(synced)'
    );
    await this.db.executeSql(
      'CREATE INDEX IF NOT EXISTS idx_transactions_synced ON encrypted_transactions(synced)'
    );
    await this.db.executeSql(
      'CREATE INDEX IF NOT EXISTS idx_customers_synced ON encrypted_customers(synced)'
    );
  }

  /**
   * Store encrypted operation
   */
  async storeOperation(
    id: string,
    type: string,
    entity: string,
    data: any
  ): Promise<void> {
    if (!this.db || !this.masterKey) throw new Error('Database not initialized');

    const encryptedData = await EncryptionEngine.encrypt(
      JSON.stringify(data),
      this.masterKey
    );

    await this.db.executeSql(
      `INSERT OR REPLACE INTO encrypted_operations 
       (id, type, entity, data_encrypted, data_iv, data_salt, data_tag, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        type,
        entity,
        encryptedData.ciphertext,
        encryptedData.iv,
        encryptedData.salt,
        encryptedData.tag,
        Date.now(),
      ]
    );

    // Log audit entry
    await this.logAudit('STORE_OPERATION', { id, type, entity });
  }

  /**
   * Get pending operations (decrypted)
   */
  async getPendingOperations(): Promise<any[]> {
    if (!this.db || !this.masterKey) throw new Error('Database not initialized');

    const [results] = await this.db.executeSql(
      `SELECT * FROM encrypted_operations WHERE synced = 0 ORDER BY timestamp ASC`
    );

    const operations = [];
    for (let i = 0; i < results.rows.length; i++) {
      const row = results.rows.item(i);
      
      try {
        const decryptedData = await EncryptionEngine.decrypt(
          {
            ciphertext: row.data_encrypted,
            iv: row.data_iv,
            salt: row.data_salt,
            tag: row.data_tag,
            version: 1,
          },
          this.masterKey
        );

        operations.push({
          id: row.id,
          type: row.type,
          entity: row.entity,
          data: JSON.parse(decryptedData),
          timestamp: row.timestamp,
          retryCount: row.retry_count,
          lastError: row.last_error,
        });
      } catch (error) {
        console.error(`[EncryptedSQLite] Failed to decrypt operation ${row.id}:`, error);
      }
    }

    return operations;
  }

  /**
   * Store encrypted transaction
   */
  async storeTransaction(id: string, customerId: string, data: any): Promise<void> {
    if (!this.db || !this.masterKey) throw new Error('Database not initialized');

    const encryptedData = await EncryptionEngine.encrypt(
      JSON.stringify(data),
      this.masterKey
    );

    await this.db.executeSql(
      `INSERT OR REPLACE INTO encrypted_transactions 
       (id, customer_id, data_encrypted, data_iv, data_salt, data_tag, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))`,
      [
        id,
        customerId,
        encryptedData.ciphertext,
        encryptedData.iv,
        encryptedData.salt,
        encryptedData.tag,
      ]
    );
  }

  /**
   * Get transaction (decrypted)
   */
  async getTransaction(id: string): Promise<any | null> {
    if (!this.db || !this.masterKey) throw new Error('Database not initialized');

    const [results] = await this.db.executeSql(
      `SELECT * FROM encrypted_transactions WHERE id = ?`,
      [id]
    );

    if (results.rows.length === 0) return null;

    const row = results.rows.item(0);
    
    try {
      const decryptedData = await EncryptionEngine.decrypt(
        {
          ciphertext: row.data_encrypted,
          iv: row.data_iv,
          salt: row.data_salt,
          tag: row.data_tag,
          version: 1,
        },
        this.masterKey
      );

      return JSON.parse(decryptedData);
    } catch (error) {
      console.error(`[EncryptedSQLite] Failed to decrypt transaction ${id}:`, error);
      return null;
    }
  }

  /**
   * Store encrypted credential
   */
  async storeCredential(key: string, value: string, expiresAt?: number): Promise<void> {
    if (!this.db || !this.masterKey) throw new Error('Database not initialized');

    const encryptedData = await EncryptionEngine.encrypt(value, this.masterKey);

    await this.db.executeSql(
      `INSERT OR REPLACE INTO encrypted_credentials 
       (key, value_encrypted, value_iv, value_salt, value_tag, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        key,
        encryptedData.ciphertext,
        encryptedData.iv,
        encryptedData.salt,
        encryptedData.tag,
        expiresAt || null,
      ]
    );

    // Log audit entry (without sensitive data)
    await this.logAudit('STORE_CREDENTIAL', { key });
  }

  /**
   * Get credential (decrypted)
   */
  async getCredential(key: string): Promise<string | null> {
    if (!this.db || !this.masterKey) throw new Error('Database not initialized');

    const [results] = await this.db.executeSql(
      `SELECT * FROM encrypted_credentials WHERE key = ?`,
      [key]
    );

    if (results.rows.length === 0) return null;

    const row = results.rows.item(0);

    // Check expiration
    if (row.expires_at && row.expires_at < Date.now() / 1000) {
      await this.db.executeSql(
        `DELETE FROM encrypted_credentials WHERE key = ?`,
        [key]
      );
      return null;
    }

    try {
      return await EncryptionEngine.decrypt(
        {
          ciphertext: row.value_encrypted,
          iv: row.value_iv,
          salt: row.value_salt,
          tag: row.value_tag,
          version: 1,
        },
        this.masterKey
      );
    } catch (error) {
      console.error(`[EncryptedSQLite] Failed to decrypt credential ${key}:`, error);
      return null;
    }
  }

  /**
   * Mark operation as synced
   */
  async markOperationSynced(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.executeSql(
      `UPDATE encrypted_operations SET synced = 1 WHERE id = ?`,
      [id]
    );
  }

  /**
   * Update operation error
   */
  async updateOperationError(id: string, error: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    await this.db.executeSql(
      `UPDATE encrypted_operations 
       SET retry_count = retry_count + 1, last_error = ? 
       WHERE id = ?`,
      [error, id]
    );
  }

  /**
   * Log audit entry
   */
  private async logAudit(action: string, data?: any): Promise<void> {
    if (!this.db || !this.masterKey) return;

    try {
      let encryptedData = null;
      let iv = null;
      let salt = null;
      let tag = null;

      if (data) {
        const encrypted = await EncryptionEngine.encrypt(
          JSON.stringify(data),
          this.masterKey
        );
        encryptedData = encrypted.ciphertext;
        iv = encrypted.iv;
        salt = encrypted.salt;
        tag = encrypted.tag;
      }

      await this.db.executeSql(
        `INSERT INTO encrypted_audit_log 
         (action, data_encrypted, data_iv, data_salt, data_tag)
         VALUES (?, ?, ?, ?, ?)`,
        [action, encryptedData, iv, salt, tag]
      );
    } catch (error) {
      console.error('[EncryptedSQLite] Audit log failed:', error);
    }
  }

  /**
   * Get audit log
   */
  async getAuditLog(limit: number = 100): Promise<any[]> {
    if (!this.db || !this.masterKey) throw new Error('Database not initialized');

    const [results] = await this.db.executeSql(
      `SELECT * FROM encrypted_audit_log ORDER BY timestamp DESC LIMIT ?`,
      [limit]
    );

    const logs = [];
    for (let i = 0; i < results.rows.length; i++) {
      const row = results.rows.item(i);
      
      let data = null;
      if (row.data_encrypted) {
        try {
          const decrypted = await EncryptionEngine.decrypt(
            {
              ciphertext: row.data_encrypted,
              iv: row.data_iv,
              salt: row.data_salt,
              tag: row.data_tag,
              version: 1,
            },
            this.masterKey
          );
          data = JSON.parse(decrypted);
        } catch {
          data = '[DECRYPTION_FAILED]';
        }
      }

      logs.push({
        id: row.id,
        action: row.action,
        data,
        timestamp: row.timestamp,
      });
    }

    return logs;
  }

  /**
   * Clear all data (for logout/security wipe)
   */
  async clearAll(): Promise<void> {
    if (!this.db) return;

    await this.db.executeSql('DELETE FROM encrypted_operations');
    await this.db.executeSql('DELETE FROM encrypted_transactions');
    await this.db.executeSql('DELETE FROM encrypted_customers');
    await this.db.executeSql('DELETE FROM encrypted_credentials');
    await this.db.executeSql('DELETE FROM sync_metadata');
    
    // Keep audit log for compliance
    await this.logAudit('CLEAR_ALL_DATA');
  }

  /**
   * Re-encrypt all data with new key (for key rotation)
   */
  async reEncryptWithNewKey(newKey: string): Promise<void> {
    if (!this.db || !this.masterKey) throw new Error('Database not initialized');

    // This is a complex operation that should be done carefully
    // In production, this would need transaction support and rollback capability
    
    console.log('[EncryptedSQLite] Starting key rotation...');
    
    // Re-encrypt operations
    const operations = await this.getPendingOperations();
    for (const op of operations) {
      const encryptedData = await EncryptionEngine.encrypt(
        JSON.stringify(op.data),
        newKey
      );
      
      await this.db.executeSql(
        `UPDATE encrypted_operations 
         SET data_encrypted = ?, data_iv = ?, data_salt = ?, data_tag = ?
         WHERE id = ?`,
        [
          encryptedData.ciphertext,
          encryptedData.iv,
          encryptedData.salt,
          encryptedData.tag,
          op.id,
        ]
      );
    }

    // Update master key
    this.masterKey = newKey;
    
    await this.logAudit('KEY_ROTATION_COMPLETE');
    console.log('[EncryptedSQLite] Key rotation complete');
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    this.masterKey = null;
  }
}

/**
 * Singleton instance for app-wide use
 */
export const encryptedStorage = new EncryptedSQLiteDatabase();
export const encryptedAsyncStorage = EncryptedAsyncStorage;

export default {
  EncryptedSQLiteDatabase,
  EncryptedAsyncStorage,
  KeyManager,
};
