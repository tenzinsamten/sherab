// Homework push notifications (#92). The generated service worker loads this
// file (`workbox.importScripts` in vite.config.ts). The server sends the
// finished text in the language of this browser: { title, body, url, tag, lang }.

self.addEventListener('push', (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		// Not ours, or not JSON: still show something, as browsers require.
	}
	event.waitUntil(
		self.registration.showNotification(data.title || 'Sherab', {
			body: data.body || '',
			icon: '/favicon-512.png',
			// A later notice of the same kind replaces the earlier one.
			tag: data.tag,
			lang: data.lang,
			data: { url: data.url }
		})
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	// Only ever a page of this app.
	const path = event.notification.data && event.notification.data.url;
	const safe = typeof path === 'string' && path.startsWith('/') && !path.startsWith('//');
	const target = new URL(safe ? path : '/', self.location.origin).href;

	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of windows) {
				if ('focus' in client) {
					await client.focus();
					if ('navigate' in client) await client.navigate(target).catch(() => {});
					return;
				}
			}
			await self.clients.openWindow(target);
		})()
	);
});
