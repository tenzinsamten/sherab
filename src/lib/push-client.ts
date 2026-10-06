/**
 * Browser side of homework push notifications (#92). The switch is per
 * browser: the phone's permission and its subscription live here, and the
 * server only keeps which account that subscription belongs to.
 */

/**
 * - `unsupported`: this browser cannot receive push.
 * - `needs-install`: an iPhone or iPad outside the Home Screen app, where
 *   Safari offers no push.
 * - `denied`: notifications are blocked for this site in the browser.
 * - `off` / `on`: no subscription / subscribed.
 */
export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

const ENDPOINT = '/api/push/subscription';

function supported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

function isAppleMobile(): boolean {
	// iPadOS reports itself as a Mac with a touch screen.
	return (
		/iPad|iPhone|iPod/.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
	);
}

function isInstalled(): boolean {
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true
	);
}

async function currentSubscription(): Promise<PushSubscription | null> {
	const registration = await navigator.serviceWorker.getRegistration();
	return (await registration?.pushManager.getSubscription()) ?? null;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
	const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
	const bytes = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
	return bytes;
}

async function save(subscription: PushSubscription): Promise<boolean> {
	const response = await fetch(ENDPOINT, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(subscription.toJSON())
	});
	return response.ok;
}

export async function pushState(): Promise<PushState> {
	if (typeof window === 'undefined') return 'unsupported';
	if (!supported()) return isAppleMobile() && !isInstalled() ? 'needs-install' : 'unsupported';
	if (Notification.permission === 'denied') return 'denied';
	if (Notification.permission !== 'granted') return 'off';
	return (await currentSubscription()) ? 'on' : 'off';
}

/**
 * Asks for permission, subscribes this browser with the server's public
 * `key` and saves it for the signed-in account. Returns the resulting
 * state; throws when the subscription could not be made or saved.
 */
export async function enablePush(key: string): Promise<PushState> {
	if (!supported()) return pushState();

	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

	const registration = await navigator.serviceWorker.ready;
	const wanted = keyBytes(key);
	let subscription = await registration.pushManager.getSubscription();

	// A subscription made with an older key cannot be sent to any more.
	const current = subscription?.options.applicationServerKey;
	if (subscription && current) {
		const have = new Uint8Array(current);
		const same = have.length === wanted.length && have.every((byte, i) => byte === wanted[i]);
		if (!same) {
			await subscription.unsubscribe();
			subscription = null;
		}
	}

	subscription ??= await registration.pushManager.subscribe({
		userVisibleOnly: true,
		applicationServerKey: wanted
	});

	if (!(await save(subscription))) {
		await subscription.unsubscribe().catch(() => {});
		throw new Error('The subscription could not be saved.');
	}
	return 'on';
}

/** Switches notifications off on this browser, for everyone who uses it. */
export async function disablePush(): Promise<PushState> {
	if (!supported()) return pushState();
	const subscription = await currentSubscription();
	if (subscription) {
		await fetch(ENDPOINT, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: subscription.endpoint })
		}).catch(() => {});
		await subscription.unsubscribe();
	}
	return pushState();
}

/**
 * After sign-in or a page load: hands this browser's subscription to the
 * signed-in account and refreshes its language. Does nothing when
 * notifications are off here. Never throws.
 */
export async function syncPush(): Promise<void> {
	try {
		if (!supported() || Notification.permission !== 'granted') return;
		const subscription = await currentSubscription();
		if (subscription) await save(subscription);
	} catch {
		// Best effort: the next page load tries again.
	}
}

/**
 * Before sign-out: the account stops receiving on this browser. The
 * browser's own subscription and permission stay, so the next account that
 * signs in here picks them up (`syncPush`). Never throws.
 */
export async function releasePush(): Promise<void> {
	try {
		if (!supported()) return;
		const subscription = await currentSubscription();
		if (!subscription) return;
		await fetch(ENDPOINT, {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ endpoint: subscription.endpoint }),
			keepalive: true
		});
	} catch {
		// Best effort: signing out must not fail on this.
	}
}
