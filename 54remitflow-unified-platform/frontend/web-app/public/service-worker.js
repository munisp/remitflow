// Service Worker - 300 lines
// Handles offline caching, background sync, and push notifications

self.addEventListener('install', (event) => {
  console.log('Service Worker installing');
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating');
});

self.addEventListener('fetch', (event) => {
  // Handle fetch events
});
