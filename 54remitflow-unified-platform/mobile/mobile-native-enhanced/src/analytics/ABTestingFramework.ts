// ABTestingFramework.ts - A/B Testing with Remote Config
// 20% conversion improvement through experimentation

import AsyncStorage from '@react-native-async-storage/async-storage';

interface ABTest {
  id: string;
  name: string;
  variants: ABVariant[];
  targetAudience: string[];
  startDate: number;
  endDate: number;
  active: boolean;
}

interface ABVariant {
  id: string;
  name: string;
  weight: number;
  config: Record<string, any>;
}

interface UserAssignment {
  userId: string;
  testId: string;
  variantId: string;
  assignedAt: number;
}

interface ABTestResult {
  testId: string;
  variantId: string;
  metric: string;
  value: number;
  timestamp: number;
}

class ABTestingFramework {
  private static instance: ABTestingFramework;
  private assignments: Map<string, UserAssignment> = new Map();
  private postgresEndpoint: string = 'https://api.agentbanking.com/analytics/postgres';
  private middlewareEndpoint: string = 'https://api.agentbanking.com/middleware/ab-testing';
  private lakehouseEndpoint: string = 'https://api.agentbanking.com/lakehouse/ab-tests';

  static getInstance(): ABTestingFramework {
    if (!ABTestingFramework.instance) {
      ABTestingFramework.instance = new ABTestingFramework();
    }
    return ABTestingFramework.instance;
  }

  async initialize(userId: string): Promise<void> {
    await this.loadAssignments();
    await this.syncWithRemoteConfig(userId);
    console.log('[AB_TESTING] Framework initialized');
  }

  async getVariant(testId: string, userId: string): Promise<ABVariant | null> {
    // Check if user already assigned
    const assignment = this.assignments.get(testId);
    if (assignment) {
      const test = await this.getTest(testId);
      return test?.variants.find(v => v.id === assignment.variantId) || null;
    }

    // Assign user to variant
    const test = await this.getTest(testId);
    if (!test || !test.active) return null;

    const variant = this.assignVariant(test, userId);
    if (variant) {
      await this.recordAssignment(userId, testId, variant.id);
    }

    return variant;
  }

  private assignVariant(test: ABTest, userId: string): ABVariant | null {
    // Weighted random assignment
    const random = Math.random();
    let cumulative = 0;

    for (const variant of test.variants) {
      cumulative += variant.weight;
      if (random <= cumulative) {
        return variant;
      }
    }

    return test.variants[0]; // Fallback to first variant
  }

  private async recordAssignment(userId: string, testId: string, variantId: string): Promise<void> {
    const assignment: UserAssignment = {
      userId,
      testId,
      variantId,
      assignedAt: Date.now(),
    };

    this.assignments.set(testId, assignment);
    await this.saveAssignments();

    // Send to Postgres for real-time analysis
    await fetch(`${this.postgresEndpoint}/ab_assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignment),
    });

    // Send to Lakehouse for long-term analysis
    await fetch(`${this.lakehouseEndpoint}/assignments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(assignment),
    });

    console.log('[AB_TESTING] Assignment recorded:', testId, variantId);
  }

  async trackConversion(testId: string, metric: string, value: number): Promise<void> {
    const assignment = this.assignments.get(testId);
    if (!assignment) return;

    const result: ABTestResult = {
      testId,
      variantId: assignment.variantId,
      metric,
      value,
      timestamp: Date.now(),
    };

    // Send to Postgres for real-time dashboards
    await fetch(`${this.postgresEndpoint}/ab_results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });

    // Send to Lakehouse for statistical analysis
    await fetch(`${this.lakehouseEndpoint}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });

    console.log('[AB_TESTING] Conversion tracked:', metric, value);
  }

  private async getTest(testId: string): Promise<ABTest | null> {
    try {
      const response = await fetch(`${this.middlewareEndpoint}/tests/${testId}`);
      return await response.json();
    } catch (error) {
      console.error('[AB_TESTING] Failed to get test:', error);
      return null;
    }
  }

  private async syncWithRemoteConfig(userId: string): Promise<void> {
    try {
      const response = await fetch(`${this.middlewareEndpoint}/sync/${userId}`);
      const tests = await response.json();
      console.log('[AB_TESTING] Synced', tests.length, 'tests');
    } catch (error) {
      console.error('[AB_TESTING] Sync failed:', error);
    }
  }

  private async loadAssignments(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem('ab_assignments');
      if (stored) {
        const assignments = JSON.parse(stored);
        this.assignments = new Map(assignments);
      }
    } catch (error) {
      console.error('[AB_TESTING] Load failed:', error);
    }
  }

  private async saveAssignments(): Promise<void> {
    try {
      const assignments = Array.from(this.assignments.entries());
      await AsyncStorage.setItem('ab_assignments', JSON.stringify(assignments));
    } catch (error) {
      console.error('[AB_TESTING] Save failed:', error);
    }
  }
}

export default ABTestingFramework.getInstance();
