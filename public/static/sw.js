const CACHE_NAME = 'noviq-ai-v3';
const APP_SHELL = ['/', '/static/style.css', '/static/script.js', '/static/Noviq%20AI%20Glossy%20Ribbon%20Logo.png', '/static/user-avatar.svg', '/static/manifest.webmanifest'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
