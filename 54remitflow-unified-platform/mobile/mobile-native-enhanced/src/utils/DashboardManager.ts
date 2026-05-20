// DashboardManager.ts - Customizable Dashboard Widgets
// Drag-and-drop widget reordering and personalization

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Widget {
  id: string;
  type: 'balance' | 'recent_transactions' | 'quick_actions' | 'insights' | 'chart';
  title: string;
  enabled: boolean;
  order: number;
  config: Record<string, any>;
}

export const DEFAULT_WIDGETS: Widget[] = [
  {
    id: 'balance',
    type: 'balance',
    title: 'Account Balance',
    enabled: true,
    order: 0,
    config: { showCurrency: true },
  },
  {
    id: 'recent',
    type: 'recent_transactions',
    title: 'Recent Transactions',
    enabled: true,
    order: 1,
    config: { limit: 5 },
  },
  {
    id: 'quick',
    type: 'quick_actions',
    title: 'Quick Actions',
    enabled: true,
    order: 2,
    config: { actions: ['send', 'request', 'scan'] },
  },
  {
    id: 'insights',
    type: 'insights',
    title: 'Spending Insights',
    enabled: true,
    order: 3,
    config: { period: 'month' },
  },
  {
    id: 'chart',
    type: 'chart',
    title: 'Spending Chart',
    enabled: false,
    order: 4,
    config: { chartType: 'pie' },
  },
];

class DashboardManager {
  private static instance: DashboardManager;
  private widgets: Widget[] = DEFAULT_WIDGETS;

  private constructor() {
    this.loadWidgets();
  }

  static getInstance(): DashboardManager {
    if (!DashboardManager.instance) {
      DashboardManager.instance = new DashboardManager();
    }
    return DashboardManager.instance;
  }

  private async loadWidgets(): Promise<void> {
    try {
      const saved = await AsyncStorage.getItem('dashboard_widgets');
      if (saved) {
        this.widgets = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load widgets:', error);
    }
  }

  private async saveWidgets(): Promise<void> {
    try {
      await AsyncStorage.setItem('dashboard_widgets', JSON.stringify(this.widgets));
    } catch (error) {
      console.error('Failed to save widgets:', error);
    }
  }

  getWidgets(): Widget[] {
    return this.widgets
      .filter(w => w.enabled)
      .sort((a, b) => a.order - b.order);
  }

  getAllWidgets(): Widget[] {
    return this.widgets;
  }

  async reorderWidgets(widgetIds: string[]): Promise<void> {
    widgetIds.forEach((id, index) => {
      const widget = this.widgets.find(w => w.id === id);
      if (widget) {
        widget.order = index;
      }
    });
    await this.saveWidgets();
  }

  async toggleWidget(widgetId: string): Promise<void> {
    const widget = this.widgets.find(w => w.id === widgetId);
    if (widget) {
      widget.enabled = !widget.enabled;
      await this.saveWidgets();
    }
  }

  async updateWidgetConfig(widgetId: string, config: Record<string, any>): Promise<void> {
    const widget = this.widgets.find(w => w.id === widgetId);
    if (widget) {
      widget.config = { ...widget.config, ...config };
      await this.saveWidgets();
    }
  }

  async resetToDefaults(): Promise<void> {
    this.widgets = DEFAULT_WIDGETS;
    await this.saveWidgets();
  }
}

export default DashboardManager.getInstance();
