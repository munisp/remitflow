// analytics-api.ts - Middleware API for Analytics
// Handles all analytics requests from frontend

import express from 'express';
import { Pool } from 'pg';
import lakehouseService from '../services/lakehouse-service';
import tigerBeetleService from '../services/tigerbeetle-service';

const router = express.Router();

// Postgres pool for analytics queries
const pgPool = new Pool({
  host: process.env.ANALYTICS_PG_HOST,
  port: parseInt(process.env.ANALYTICS_PG_PORT || '5432'),
  database: process.env.ANALYTICS_PG_DB,
  user: process.env.ANALYTICS_PG_USER,
  password: process.env.ANALYTICS_PG_PASSWORD,
  max: 50,
});

// ========== LAKEHOUSE ENDPOINTS ==========

// Ingest events to lakehouse
router.post('/lakehouse/events/:table', async (req, res) => {
  try {
    const { table } = req.params;
    const data = req.body;

    if (Array.isArray(data)) {
      await lakehouseService.ingestBatch(table, data);
    } else {
      await lakehouseService.ingestEvent(table, data);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Lakehouse ingest failed:', error);
    res.status(500).json({ error: 'Ingest failed' });
  }
});

// ========== POSTGRES ANALYTICS ENDPOINTS ==========

// Insert into Postgres analytics tables
router.post('/analytics/postgres/:table', async (req, res) => {
  try {
    const { table } = req.params;
    const data = req.body;

    const client = await pgPool.connect();
    
    try {
      const columns = Object.keys(data);
      const values = Object.values(data);
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

      const query = `
        INSERT INTO analytics.${table} (${columns.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT DO NOTHING
        RETURNING *
      `;

      const result = await client.query(query, values);
      res.json({ success: true, data: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[API] Postgres insert failed:', error);
    res.status(500).json({ error: 'Insert failed' });
  }
});

// Get onboarding completion rate
router.get('/analytics/postgres/onboarding/completion-rate', async (req, res) => {
  try {
    const query = `
      WITH total_users AS (
        SELECT COUNT(DISTINCT user_id) as count
        FROM analytics.onboarding_metrics
        WHERE step = 1
      ),
      completed_users AS (
        SELECT COUNT(DISTINCT user_id) as count
        FROM analytics.onboarding_metrics
        WHERE step = 9 AND completed = true
      )
      SELECT 
        CASE 
          WHEN total_users.count = 0 THEN 0
          ELSE (completed_users.count::float / total_users.count::float) * 100
        END as completion_rate
      FROM total_users, completed_users
    `;

    const result = await pgPool.query(query);
    res.json({ completionRate: result.rows[0].completion_rate });
  } catch (error) {
    console.error('[API] Completion rate query failed:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get feature adoption rate
router.get('/analytics/postgres/features/:featureName/adoption-rate', async (req, res) => {
  try {
    const { featureName } = req.params;

    const query = `
      WITH total_users AS (
        SELECT COUNT(DISTINCT user_id) as count
        FROM analytics.events
      ),
      feature_users AS (
        SELECT COUNT(DISTINCT user_id) as count
        FROM analytics.feature_adoption
        WHERE feature_name = $1
      )
      SELECT 
        CASE 
          WHEN total_users.count = 0 THEN 0
          ELSE (feature_users.count::float / total_users.count::float) * 100
        END as adoption_rate
      FROM total_users, feature_users
    `;

    const result = await pgPool.query(query, [featureName]);
    res.json({ adoptionRate: result.rows[0].adoption_rate });
  } catch (error) {
    console.error('[API] Adoption rate query failed:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get retention rates
router.get('/analytics/postgres/retention/rates', async (req, res) => {
  try {
    const query = `
      WITH total_users AS (
        SELECT COUNT(*) as count
        FROM analytics.retention_metrics
      ),
      day1_users AS (
        SELECT COUNT(*) as count
        FROM analytics.retention_metrics
        WHERE day1_active = true
      ),
      day7_users AS (
        SELECT COUNT(*) as count
        FROM analytics.retention_metrics
        WHERE day7_active = true
      ),
      day30_users AS (
        SELECT COUNT(*) as count
        FROM analytics.retention_metrics
        WHERE day30_active = true
      )
      SELECT 
        CASE WHEN total_users.count = 0 THEN 0 ELSE (day1_users.count::float / total_users.count::float) * 100 END as day1_rate,
        CASE WHEN total_users.count = 0 THEN 0 ELSE (day7_users.count::float / total_users.count::float) * 100 END as day7_rate,
        CASE WHEN total_users.count = 0 THEN 0 ELSE (day30_users.count::float / total_users.count::float) * 100 END as day30_rate
      FROM total_users, day1_users, day7_users, day30_users
    `;

    const result = await pgPool.query(query);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('[API] Retention rates query failed:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get average session duration
router.get('/analytics/postgres/sessions/average-duration', async (req, res) => {
  try {
    const query = `
      SELECT AVG(duration) as average_duration
      FROM analytics.session_metrics
      WHERE duration > 0
    `;

    const result = await pgPool.query(query);
    res.json({ averageDuration: result.rows[0].average_duration || 0 });
  } catch (error) {
    console.error('[API] Average duration query failed:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get error rate
router.get('/analytics/postgres/errors/rate', async (req, res) => {
  try {
    const query = `
      WITH total_sessions AS (
        SELECT COUNT(*) as count
        FROM analytics.session_metrics
      ),
      error_sessions AS (
        SELECT COUNT(*) as count
        FROM analytics.session_metrics
        WHERE errors > 0
      )
      SELECT 
        CASE 
          WHEN total_sessions.count = 0 THEN 0
          ELSE (error_sessions.count::float / total_sessions.count::float) * 100
        END as error_rate
      FROM total_sessions, error_sessions
    `;

    const result = await pgPool.query(query);
    res.json({ errorRate: result.rows[0].error_rate });
  } catch (error) {
    console.error('[API] Error rate query failed:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get crash-free rate
router.get('/analytics/postgres/crashes/crash-free-rate', async (req, res) => {
  try {
    const query = `
      WITH total_sessions AS (
        SELECT COUNT(*) as count
        FROM analytics.session_metrics
        WHERE created_at >= NOW() - INTERVAL '7 days'
      ),
      crash_sessions AS (
        SELECT COUNT(DISTINCT session_id) as count
        FROM analytics.crashes
        WHERE created_at >= NOW() - INTERVAL '7 days'
      )
      SELECT 
        CASE 
          WHEN total_sessions.count = 0 THEN 100
          ELSE ((total_sessions.count - crash_sessions.count)::float / total_sessions.count::float) * 100
        END as crash_free_rate
      FROM total_sessions, crash_sessions
    `;

    const result = await pgPool.query(query);
    res.json({ crashFreeRate: result.rows[0].crash_free_rate });
  } catch (error) {
    console.error('[API] Crash-free rate query failed:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get feedback stats
router.get('/analytics/postgres/feedback/stats', async (req, res) => {
  try {
    const query = `
      SELECT 
        AVG(rating) as average_rating,
        COUNT(*) as total_feedback
      FROM analytics.user_feedback
    `;

    const result = await pgPool.query(query);
    res.json({
      averageRating: result.rows[0].average_rating || 0,
      totalFeedback: parseInt(result.rows[0].total_feedback) || 0,
    });
  } catch (error) {
    console.error('[API] Feedback stats query failed:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get funnel analysis
router.get('/analytics/postgres/funnels/:funnelId/analysis', async (req, res) => {
  try {
    const { funnelId } = req.params;

    const query = `
      SELECT 
        step_id,
        step_name,
        COUNT(*) FILTER (WHERE action = 'enter') as entered,
        COUNT(*) FILTER (WHERE action = 'complete') as completed,
        COUNT(*) FILTER (WHERE action = 'drop') as dropped,
        CASE 
          WHEN COUNT(*) FILTER (WHERE action = 'enter') = 0 THEN 0
          ELSE (COUNT(*) FILTER (WHERE action = 'complete')::float / COUNT(*) FILTER (WHERE action = 'enter')::float) * 100
        END as conversion_rate
      FROM analytics.funnel_events
      WHERE funnel_id = $1
      GROUP BY step_id, step_name
      ORDER BY step_id
    `;

    const result = await pgPool.query(query, [funnelId]);
    res.json(result.rows);
  } catch (error) {
    console.error('[API] Funnel analysis query failed:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// Get revenue metrics
router.get('/analytics/postgres/revenue/metrics', async (req, res) => {
  try {
    const query = `
      WITH revenue_data AS (
        SELECT 
          SUM(CASE WHEN event_type = 'purchase' THEN amount ELSE 0 END) as total_revenue,
          COUNT(DISTINCT user_id) as total_users
        FROM analytics.revenue_events
        WHERE created_at >= NOW() - INTERVAL '30 days'
      )
      SELECT 
        total_revenue,
        CASE WHEN total_users = 0 THEN 0 ELSE total_revenue / total_users END as arpu,
        total_revenue * 12 as ltv
      FROM revenue_data
    `;

    const result = await pgPool.query(query);
    res.json({
      totalRevenue: parseFloat(result.rows[0].total_revenue) || 0,
      arpu: parseFloat(result.rows[0].arpu) || 0,
      ltv: parseFloat(result.rows[0].ltv) || 0,
    });
  } catch (error) {
    console.error('[API] Revenue metrics query failed:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

// ========== A/B TESTING ENDPOINTS ==========

// Get A/B test
router.get('/middleware/ab-testing/tests/:testId', async (req, res) => {
  try {
    const { testId } = req.params;

    // In production, this would fetch from a config service
    // For now, return a mock test
    const test = {
      id: testId,
      name: 'Onboarding Flow Test',
      variants: [
        { id: 'control', name: 'Control', weight: 0.5, config: { flow: 'original' } },
        { id: 'variant_a', name: 'Variant A', weight: 0.5, config: { flow: 'simplified' } },
      ],
      targetAudience: [],
      startDate: Date.now() - 7 * 24 * 60 * 60 * 1000,
      endDate: Date.now() + 7 * 24 * 60 * 60 * 1000,
      active: true,
    };

    res.json(test);
  } catch (error) {
    console.error('[API] Get test failed:', error);
    res.status(500).json({ error: 'Get test failed' });
  }
});

// Sync A/B tests for user
router.get('/middleware/ab-testing/sync/:userId', async (req, res) => {
  try {
    // In production, fetch active tests from config service
    const tests = [
      {
        id: 'onboarding_test',
        name: 'Onboarding Flow Test',
        active: true,
      },
      {
        id: 'pricing_test',
        name: 'Pricing Page Test',
        active: true,
      },
    ];

    res.json(tests);
  } catch (error) {
    console.error('[API] Sync tests failed:', error);
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Get feature flag
router.get('/middleware/analytics/feature-flags/:flagId/:userId', async (req, res) => {
  try {
    const { flagId, userId } = req.params;

    // In production, fetch from feature flag service
    const flag = {
      flagId,
      name: 'New Dashboard',
      enabled: true,
      rolloutPercentage: 50,
      targetUsers: [],
    };

    res.json(flag);
  } catch (error) {
    console.error('[API] Get feature flag failed:', error);
    res.status(500).json({ error: 'Get flag failed' });
  }
});

// ========== MIDDLEWARE PROCESSING ENDPOINTS ==========

// Process screen views
router.post('/middleware/analytics/screen_views', async (req, res) => {
  try {
    const data = req.body;

    // Send to lakehouse for analysis
    await lakehouseService.ingestEvent('screen_views', data);

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Screen view processing failed:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// Process clicks (for heatmaps)
router.post('/middleware/analytics/clicks', async (req, res) => {
  try {
    const data = req.body;

    // Send to lakehouse for heatmap generation
    await lakehouseService.ingestEvent('clicks', data);

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Click processing failed:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// Process crashes (send to Sentry)
router.post('/middleware/sentry/crashes', async (req, res) => {
  try {
    const data = req.body;

    // In production, send to Sentry API
    console.log('[SENTRY] Crash received:', data.crashType);

    // Also store in Postgres
    await pgPool.query(
      'INSERT INTO analytics.crashes (crash_id, user_id, error_type, error_message, stack_trace, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
      [`crash_${Date.now()}`, data.userId, data.crashType, data.crashMessage, data.stackTrace, Date.now()]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Crash processing failed:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// Process events batch
router.post('/middleware/analytics/events', async (req, res) => {
  try {
    const events = req.body;

    // Send to lakehouse
    await lakehouseService.ingestBatch('events', events);

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Events batch processing failed:', error);
    res.status(500).json({ error: 'Processing failed' });
  }
});

// ========== TIGERBEETLE REVENUE ENDPOINTS ==========

// Track revenue
router.post('/tigerbeetle/revenue', async (req, res) => {
  try {
    const { userId, amount, currency, transactionId } = req.body;

    await tigerBeetleService.trackRevenue(userId, amount, currency, transactionId);

    res.json({ success: true });
  } catch (error) {
    console.error('[API] Revenue tracking failed:', error);
    res.status(500).json({ error: 'Revenue tracking failed' });
  }
});

// Get revenue balance
router.get('/tigerbeetle/revenue/balance', async (req, res) => {
  try {
    const balance = await tigerBeetleService.getRevenueBalance();
    res.json({ balance });
  } catch (error) {
    console.error('[API] Get revenue balance failed:', error);
    res.status(500).json({ error: 'Get balance failed' });
  }
});

export default router;
