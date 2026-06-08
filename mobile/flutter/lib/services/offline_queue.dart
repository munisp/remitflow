import 'dart:convert';
import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

/// Offline queue for pending operations when network is unavailable.
/// Stores transfers, KYC uploads, and other mutations in local SQLite,
/// then syncs when connectivity is restored.
///
/// Middleware-ready: in production, swap SQLite → Realm or Hive for
/// encrypted local storage. The queue interface stays the same.
class OfflineQueue {
  static Database? _db;
  static const String _tableName = 'pending_operations';

  static Future<Database> get database async {
    if (_db != null) return _db!;
    final dbPath = await getDatabasesPath();
    _db = await openDatabase(
      join(dbPath, 'remitflow_offline.db'),
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE $_tableName (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_type TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            payload TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            max_retries INTEGER NOT NULL DEFAULT 5,
            created_at TEXT NOT NULL,
            last_attempt_at TEXT,
            error_message TEXT,
            idempotency_key TEXT UNIQUE NOT NULL
          )
        ''');
        await db.execute(
          'CREATE INDEX idx_pending_status ON $_tableName (status)',
        );
      },
    );
    return _db!;
  }

  /// Enqueue an operation for later sync.
  static Future<int> enqueue({
    required String operationType,
    required String endpoint,
    required Map<String, dynamic> payload,
    String? idempotencyKey,
  }) async {
    final db = await database;
    final key = idempotencyKey ??
        '${operationType}_${DateTime.now().millisecondsSinceEpoch}';
    return db.insert(_tableName, {
      'operation_type': operationType,
      'endpoint': endpoint,
      'payload': jsonEncode(payload),
      'status': 'pending',
      'retry_count': 0,
      'max_retries': 5,
      'created_at': DateTime.now().toIso8601String(),
      'idempotency_key': key,
    }, conflictAlgorithm: ConflictAlgorithm.ignore);
  }

  /// Get all pending operations, ordered by creation time.
  static Future<List<Map<String, dynamic>>> getPending() async {
    final db = await database;
    return db.query(
      _tableName,
      where: 'status = ? AND retry_count < max_retries',
      whereArgs: ['pending'],
      orderBy: 'created_at ASC',
    );
  }

  /// Mark an operation as completed.
  static Future<void> markCompleted(int id) async {
    final db = await database;
    await db.update(
      _tableName,
      {'status': 'completed', 'last_attempt_at': DateTime.now().toIso8601String()},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  /// Mark an operation as failed and increment retry count.
  static Future<void> markFailed(int id, String errorMessage) async {
    final db = await database;
    await db.rawUpdate(
      'UPDATE $_tableName SET retry_count = retry_count + 1, '
      'last_attempt_at = ?, error_message = ?, '
      'status = CASE WHEN retry_count + 1 >= max_retries THEN \'failed\' ELSE \'pending\' END '
      'WHERE id = ?',
      [DateTime.now().toIso8601String(), errorMessage, id],
    );
  }

  /// Get count of pending operations (for badge display).
  static Future<int> pendingCount() async {
    final db = await database;
    final result = await db.rawQuery(
      'SELECT COUNT(*) as cnt FROM $_tableName WHERE status = ?',
      ['pending'],
    );
    return (result.first['cnt'] as int?) ?? 0;
  }

  /// Clear all completed operations older than 7 days.
  static Future<int> cleanup() async {
    final db = await database;
    final cutoff = DateTime.now()
        .subtract(const Duration(days: 7))
        .toIso8601String();
    return db.delete(
      _tableName,
      where: 'status = ? AND created_at < ?',
      whereArgs: ['completed', cutoff],
    );
  }
}
