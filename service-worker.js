
const APP_FILES = [
	'index.html',
	'./',
	'app-6897251.js',
	'wrk-6375822.js',
	'custom-eaf9cd9.css',
	'bootstrap-5f7780f.css',
	'manifest.json',
	'favicon.ico',
	'images/icons/icon-128x128.png',
'images/icons/icon-144x144.png',
'images/icons/icon-152x152.png',
'images/icons/icon-192x192.png',
'images/icons/icon-32x32.png',
'images/icons/icon-384x384.png',
'images/icons/icon-512x512.png',
'images/icons/icon-72x72.png',
'images/icons/icon-96x96.png',
];

const CURRENT_CACHE_NAME = 'app-1555789133';

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CURRENT_CACHE_NAME)
			.then(cache => cache.addAll(APP_FILES))
			.then(self.skipWaiting()));
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys()
			.then(names => names.filter(n => n != CURRENT_CACHE_NAME))
			.then(names => Promise.all(names.map(c => caches.delete(c))))
			.then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
	event.respondWith(
		caches.match(event.request)
			.then(response => response || fetch(event.request)));

});
