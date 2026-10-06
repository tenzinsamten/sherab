import { env } from '$env/dynamic/private';
import { sendNotification } from 'web-push-neo';
import { todayInBerlin } from '$lib/berlin-date';
import { formatDay, num } from '$lib/format';
import { pickLocalized } from '$lib/localized-name';
import * as m from '$lib/paraglide/messages.js';
import { createSupabaseAdminClient } from '$lib/supabase/admin';
import type { Database } from '$lib/supabase/database.types';

/**
 * Homework push notifications (#92): who gets which notice is decided in SQL
 * (`homework_push_targets`, 0037); this module writes the text in each
 * browser's language, hands it to the push service and logs what went out.
 *
 * The feature is off until the three `VAPID_*` variables are set, and every
 * function here then does nothing.
 */

export const PUSH_KINDS = ['added', 'due_soon', 'overdue'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export type PushLocale = 'en' | 'de' | 'bo';
export type PushTarget =
	Database['public']['Functions']['homework_push_targets']['Returns'][number];

/** What the service worker (`static/push-sw.js`) receives. */
export type PushMessage = { title: string; body: string; url: string; tag: string; lang: string };

/**
 * Notices handed to the push service in one request. Cloudflare's free plan
 * allows 50 outgoing calls per request; a batch plus the database calls
 * around it stays well under that. Whatever is left goes out on the next
 * call (the job runs every 5 minutes through the morning).
 */
export const PUSH_BATCH = 20;

/** How often an "added" notice may ask for another batch (8 x 20 browsers). */
export const PUSH_MAX_DEPTH = 8;

/** The push service keeps an undelivered notice this long (phone off). */
const PUSH_TTL_SECONDS = 2 * 24 * 60 * 60;

const TITLE_MAX = 80;

type PushConfig = { publicKey: string; privateKey: string; subject: string };

/** The VAPID key pair and contact address, or null while the feature is off. */
export function pushConfig(): PushConfig | null {
	const publicKey = env.VAPID_PUBLIC_KEY?.trim();
	const privateKey = env.VAPID_PRIVATE_KEY?.trim();
	const subject = env.VAPID_SUBJECT?.trim();
	if (!publicKey || !privateKey || !subject) return null;
	return { publicKey, privateKey, subject };
}

/** The key a browser subscribes with; null hides the switch. */
export function pushPublicKey(): string | null {
	return pushConfig()?.publicKey ?? null;
}

/**
 * The browsers' push services. A subscription's endpoint comes from the
 * client and the server posts to it, so anything else is refused: both when
 * it is saved and again before sending.
 */
const PUSH_HOSTS = [
	'fcm.googleapis.com',
	'android.googleapis.com',
	'.push.services.mozilla.com',
	'.notify.windows.com',
	'.push.apple.com'
];

export function isPushEndpoint(endpoint: unknown): endpoint is string {
	if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:' || url.port !== '' || url.username !== '') return false;
	return PUSH_HOSTS.some((host) =>
		host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host
	);
}

export type ParsedSubscription = { endpoint: string; p256dh: string; auth: string };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** `PushSubscription.toJSON()` as sent by the browser, or null when malformed. */
export function parseSubscription(body: unknown): ParsedSubscription | null {
	const value = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
	const p256dh = value?.keys?.p256dh;
	const auth = value?.keys?.auth;
	if (!isPushEndpoint(value?.endpoint)) return null;
	if (typeof p256dh !== 'string' || typeof auth !== 'string') return null;
	// A 65-byte public key and a 16-byte secret, base64url without padding.
	if (!BASE64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return null;
	if (!BASE64URL.test(auth) || auth.length < 20 || auth.length > 40) return null;
	return { endpoint: value!.endpoint as string, p256dh, auth };
}

/** Compares two secrets without leaking where they first differ. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [x, y] = await Promise.all(
		[a, b].map(
			async (v) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(v)))
		)
	);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
	return diff === 0;
}

function clip(text: string, max = TITLE_MAX): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * One notice for one recipient, in `locale`. `rows` are that recipient's
 * targets of one kind: a student's own homework, or a parent's children's.
 *
 * One piece of homework is named in full ("Class: title, due 12 October",
 * with the child's name in a parent's title). Several become a short list
 * under a plain title.
 */
export function buildPushMessage(
	kind: PushKind,
	rows: PushTarget[],
	locale: PushLocale
): PushMessage {
	const opt = { locale };
	const forParent = rows[0].recipient_id !== rows[0].student_id;
	const url = forParent ? '/parent/homework' : '/student/homework';

	const plainTitle =
		kind === 'added'
			? m.push_added_title({}, opt)
			: kind === 'due_soon'
				? m.push_due_soon_title({}, opt)
				: m.push_overdue_title({}, opt);

	const instances = new Set(rows.map((r) => r.instance_id));
	if (instances.size === 1) {
		const row = rows[0];
		// The same homework for two children of one parent names both.
		const child = [...new Set(rows.map((r) => r.student_name?.trim() ?? ''))]
			.filter(Boolean)
			.join(', ');
		const title =
			!forParent || !child
				? plainTitle
				: kind === 'added'
					? m.push_added_title_parent({ child }, opt)
					: kind === 'due_soon'
						? m.push_due_soon_title_parent({ child }, opt)
						: m.push_overdue_title_parent({ child }, opt);
		const item = {
			className: pickLocalized(row.class_name, row.class_name_bo, row.class_name_de, locale),
			title: clip(row.title),
			date: formatDay(row.due_date, { day: 'numeric', month: 'long' }, locale)
		};
		return {
			title: clip(title),
			body: kind === 'overdue' ? m.push_item_body_overdue(item, opt) : m.push_item_body(item, opt),
			url,
			tag: `homework-${kind}-${row.instance_id}`,
			lang: locale
		};
	}

	const shown = rows.slice(0, 3).map((r) => {
		const child = r.student_name?.trim();
		return clip(forParent && child ? `${child}: ${r.title}` : r.title);
	});
	if (rows.length > shown.length) {
		shown.push(m.push_more({ count: num(rows.length - shown.length, locale) }, opt));
	}
	return { title: plainTitle, body: shown.join('\n'), url, tag: `homework-${kind}`, lang: locale };
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/** Replaceable in tests. `rotate` picks where a batch starts (0..count-1). */
export type PushDeps = {
	config?: PushConfig | null;
	admin?: AdminClient;
	send?: typeof sendNotification;
	rotate?: (count: number) => number;
	now?: Date;
};

export type PushResult = {
	/** Recipients who got the notice on at least one browser. */
	recipients: number;
	sent: number;
	/** Subscriptions the push service no longer knows; deleted. */
	removed: number;
	failed: number;
	/** More recipients are owed this notice than one batch covers. */
	remaining: boolean;
};

const emptyResult = (): PushResult => ({
	recipients: 0,
	sent: 0,
	removed: 0,
	failed: 0,
	remaining: false
});

/**
 * Sends one batch of the notices of `kind` that are still owed and logs
 * them, so calling again sends only what is left. Never throws: a failure
 * is logged and counted.
 */
export async function sendHomeworkPush(
	kind: PushKind,
	options: { instanceId?: string; maxSends?: number } = {},
	deps: PushDeps = {}
): Promise<PushResult> {
	const result = emptyResult();
	const config = deps.config === undefined ? pushConfig() : deps.config;
	const maxSends = options.maxSends ?? PUSH_BATCH;
	if (!config || maxSends <= 0) return result;

	const admin = deps.admin ?? createSupabaseAdminClient();
	const send = deps.send ?? sendNotification;

	const { data: targets, error: targetsError } = await admin.rpc('homework_push_targets', {
		p_kind: kind,
		p_instance_id: options.instanceId
	});
	if (targetsError) {
		console.error('push: failed to read targets', targetsError.message);
		return result;
	}
	if (!targets || targets.length === 0) return result;

	const byRecipient = new Map<string, PushTarget[]>();
	for (const row of targets) {
		const rows = byRecipient.get(row.recipient_id);
		if (rows) rows.push(row);
		else byRecipient.set(row.recipient_id, [row]);
	}

	// Every listed recipient has at least one subscription, so at most
	// `maxSends` of them fit. Start somewhere else each time: a recipient
	// whose sends keep failing must not hold up everyone behind them.
	const everyone = [...byRecipient.keys()];
	const start =
		everyone.length > maxSends
			? (deps.rotate ?? ((n) => Math.floor(Math.random() * n)))(everyone.length)
			: 0;
	const candidates = [...everyone.slice(start), ...everyone.slice(0, start)].slice(0, maxSends);

	const { data: subscriptions, error: subscriptionsError } = await admin
		.from('push_subscriptions')
		.select('id, profile_id, endpoint, p256dh, auth, locale')
		.in('profile_id', candidates)
		.order('created_at');
	if (subscriptionsError) {
		console.error('push: failed to read subscriptions', subscriptionsError.message);
		return result;
	}

	const byOwner = new Map<string, NonNullable<typeof subscriptions>>();
	for (const sub of subscriptions ?? []) {
		const mine = byOwner.get(sub.profile_id);
		if (mine) mine.push(sub);
		else byOwner.set(sub.profile_id, [sub]);
	}

	// Whole recipients only, until the batch is full.
	const chosen: string[] = [];
	let planned = 0;
	for (const id of candidates) {
		const count = byOwner.get(id)?.length ?? 0;
		if (count === 0) continue;
		if (planned > 0 && planned + count > maxSends) break;
		chosen.push(id);
		planned += count;
	}
	result.remaining = chosen.length < everyone.length;

	const gone: string[] = [];
	const delivered = new Set<string>();

	await Promise.all(
		chosen.flatMap((id) =>
			byOwner.get(id)!.map(async (sub) => {
				if (!isPushEndpoint(sub.endpoint)) {
					gone.push(sub.id);
					result.removed++;
					return;
				}
				const message = buildPushMessage(kind, byRecipient.get(id)!, sub.locale as PushLocale);
				try {
					await send(
						{ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
						JSON.stringify(message),
						{
							vapidDetails: config,
							TTL: PUSH_TTL_SECONDS,
							signal: AbortSignal.timeout(10_000)
						}
					);
					result.sent++;
					delivered.add(id);
				} catch (err) {
					// The endpoint is a secret address: log the status only.
					const status = (err as { statusCode?: unknown } | null)?.statusCode;
					if (status === 404 || status === 410) {
						// The browser dropped this subscription.
						gone.push(sub.id);
						result.removed++;
					} else {
						result.failed++;
						console.error('push: send failed', typeof status === 'number' ? status : String(err));
					}
				}
			})
		)
	);
	result.recipients = delivered.size;

	if (gone.length > 0) {
		const { error } = await admin.from('push_subscriptions').delete().in('id', gone);
		if (error) console.error('push: failed to delete old subscriptions', error.message);
	}

	const logRows = [...delivered].flatMap((id) =>
		byRecipient.get(id)!.map((row) => ({
			kind,
			instance_id: row.instance_id,
			student_id: row.student_id,
			recipient_id: row.recipient_id
		}))
	);
	if (logRows.length > 0) {
		const { error } = await admin.from('push_notification_log').upsert(logRows, {
			onConflict: 'kind,instance_id,student_id,recipient_id',
			ignoreDuplicates: true
		});
		// Not logged means sent again on the next run: say so loudly.
		if (error) console.error('push: failed to log sent notices', error.message);
	}

	return result;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PushRunRequest = { kind?: unknown; instanceId?: unknown; depth?: unknown } | null;

export type PushRunResult = {
	added?: PushResult;
	overdue?: PushResult;
	/** Null on every day but Saturday. */
	dueSoon?: PushResult | null;
};

/**
 * What `/api/push/run` does once the caller is authorized.
 *
 * `{ kind: 'added', instanceId }`: the notice for homework just created.
 * While a batch leaves recipients over, it asks the database to call again
 * (`trigger_homework_push`), at most `PUSH_MAX_DEPTH` times.
 *
 * Anything else is the scheduled run: Overdue to parents, and on a Saturday
 * (in Berlin) Due soon to students and parents, sharing one batch.
 */
export async function runHomeworkPush(
	request: PushRunRequest,
	deps: PushDeps = {}
): Promise<PushRunResult> {
	if (request?.kind === 'added') {
		const instanceId = request.instanceId;
		if (typeof instanceId !== 'string' || !UUID.test(instanceId)) return {};
		const depth =
			typeof request.depth === 'number' && Number.isInteger(request.depth) && request.depth > 0
				? request.depth
				: 0;
		const added = await sendHomeworkPush('added', { instanceId }, deps);
		if (added.remaining && depth < PUSH_MAX_DEPTH) {
			const admin = deps.admin ?? createSupabaseAdminClient();
			const { error } = await admin.rpc('trigger_homework_push', {
				p_kind: 'added',
				p_instance_id: instanceId,
				p_depth: depth + 1
			});
			if (error) console.error('push: failed to ask for the next batch', error.message);
		}
		return { added };
	}

	const overdue = await sendHomeworkPush('overdue', { maxSends: PUSH_BATCH }, deps);
	const used = overdue.sent + overdue.removed + overdue.failed;
	const today = new Date(`${todayInBerlin(deps.now)}T00:00:00Z`);
	const dueSoon =
		today.getUTCDay() === 6
			? await sendHomeworkPush('due_soon', { maxSends: PUSH_BATCH - used }, deps)
			: null;
	return { overdue, dueSoon };
}

/**
 * Called when a teacher creates one-off homework. The sending happens in a
 * request of its own, started by the database, because this one has already
 * spent its outgoing calls on the assignment. Nothing is sent while the
 * feature or the Vault secrets are not set up. Never throws.
 */
export async function announceHomework(instanceId: string, deps: PushDeps = {}): Promise<void> {
	const config = deps.config === undefined ? pushConfig() : deps.config;
	if (!config) return;
	try {
		const admin = deps.admin ?? createSupabaseAdminClient();
		const { error } = await admin.rpc('trigger_homework_push', {
			p_kind: 'added',
			p_instance_id: instanceId
		});
		if (error) console.error('push: failed to announce homework', error.message);
	} catch (err) {
		console.error('push: failed to announce homework', String(err));
	}
}
