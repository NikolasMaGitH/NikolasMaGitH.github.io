'use strict';
const CACHE = 'localmusic-pwa-v1-1';
const FILES = ['./', './index.html', './app.js', './styles.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const BASE = new URL('./', self.registration.scope);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('localmusic-pwa-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  // Avoid returning index.html to a missing JavaScript, stylesheet, or icon request.
  event.respondWith(caches.match(request, {ignoreSearch: true}).then(cached => {
    if (cached) return cached;
    return fetch(request).catch(async () => {
      if (request.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    });
  }));
});
