class OrderStatusNotifications {
  constructor() {
    this.permission = 'default';
    this.init();
  }

  async init() {
    if ('Notification' in window) {
      this.permission = Notification.permission;
    }
  }

  async requestPermission() {
    if ('Notification' in window) {
      this.permission = await Notification.requestPermission();
      return this.permission === 'granted';
    }
    return false;
  }

  async sendNotification(title, options = {}) {
    if (this.permission !== 'granted') {
      await this.requestPermission();
    }

    if (this.permission === 'granted' && 'serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png',
        vibrate: [200, 100, 200],
        ...options
      });
    }
  }

  async sendOrderUpdate(orderId, status) {
    await this.sendNotification('Order Update', {
      body: `Order ${orderId} is now ${status}`,
      tag: `order-${orderId}`,
      data: { orderId, status, type: 'order_update' }
    });
  }
}

export const orderstatusnotifications = new OrderStatusNotifications();
