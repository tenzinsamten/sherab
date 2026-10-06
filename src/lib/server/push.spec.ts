import { describe, expect, it, vi } from 'vitest';
import {
	PUSH_MAX_DEPTH,
	announceHomework,
	buildPushMessage,
	isPushEndpoint,
	parseSubscription,
	runHomeworkPush,
	safeEqual,
	sendHomeworkPush,
	type PushDeps,
	type PushTarget
} from './push';

/**
 * #92. The rule for who is owed a notice lives in SQL and is tested in
 * rls.spec.ts; here the database is a fake that hands back fixed targets
 * and subscriptions and records what was deleted and logged.
 */

const config = { publicKey: 'public', privateKey: 'private', subject: 'mailto:admin@example.org' };

const STUDENT = '00000000-0000-4000-8000-000000000001';
const SIBLING = '00000000-0000-4000-8000-000000000002';
const PARENT = '00000000-0000-4000-8000-000000000003';
const INSTANCE = '10000000-0000-4000-8000-000000000001';

function target(over: Partial<PushTarget> = {}): PushTarget {
	return {
		recipient_id: STUDENT,
		student_id: STUDENT,
		student_name: 'Tenzin',
		instance_id: INSTANCE,
		title: 'Read chapter 3',
		class_name: 'Beginners',
		class_name_bo: null,
		class_name_de: 'Anfänger',
		due_date: '2026-10-11',
		...over
	};
}

type Subscription = {
	id: string;
	profile_id: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	locale: string;
};

function subscription(profileId: string, over: Partial<Subscription> = {}): Subscription {
	const id = over.id ?? `sub-${profileId.slice(-1)}-${Math.random().toString(36).slice(2, 8)}`;
	return {
		id,
		profile_id: profileId,
		endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
		p256dh: 'p256dh',
		auth: 'auth',
		locale: 'en',
		...over
	};
}

function fakeAdmin(options: {
	targets: PushTarget[] | ((kind: string) => PushTarget[]);
	subscriptions: Subscription[];
}) {
	const calls = {
		rpc: [] as { name: string; args: Record<string, unknown> }[],
		deleted: [] as string[][],
		logged: [] as Record<string, unknown>[][]
	};
	const admin = {
		rpc: async (name: string, args: Record<string, unknown>) => {
			calls.rpc.push({ name, args });
			if (name !== 'homework_push_targets') return { data: 1, error: null };
			const kind = String(args.p_kind);
			const rows = typeof options.targets === 'function' ? options.targets(kind) : options.targets;
			return { data: rows, error: null };
		},
		from: (table: string) => {
			if (table === 'push_subscriptions') {
				return {
					select: () => ({
						in: (_column: string, ids: string[]) => ({
							order: async () => ({
								data: options.subscriptions.filter((s) => ids.includes(s.profile_id)),
								error: null
							})
						})
					}),
					delete: () => ({
						in: async (_column: string, ids: string[]) => {
							calls.deleted.push(ids);
							return { error: null };
						}
					})
				};
			}
			return {
				upsert: async (rows: Record<string, unknown>[]) => {
					calls.logged.push(rows);
					return { error: null };
				}
			};
		}
	};
	return { admin: admin as unknown as NonNullable<PushDeps['admin']>, calls };
}

type Sent = { endpoint: string; message: { title: string; body: string; url: string } };

/** A sender that records each notice; `fail` maps an endpoint to a status. */
function fakeSend(fail: Record<string, number | Error> = {}) {
	const sent: Sent[] = [];
	const send = vi.fn(async (sub: { endpoint: string }, payload?: unknown) => {
		const failure = fail[sub.endpoint];
		if (failure instanceof Error) throw failure;
		if (failure) throw Object.assign(new Error('push service said no'), { statusCode: failure });
		sent.push({ endpoint: sub.endpoint, message: JSON.parse(String(payload)) });
		return { statusCode: 201, headers: new Headers(), body: '' };
	});
	return { send: send as unknown as NonNullable<PushDeps['send']>, sent };
}

describe('isPushEndpoint', () => {
	it.each([
		'https://fcm.googleapis.com/fcm/send/abc',
		'https://updates.push.services.mozilla.com/wpush/v2/abc',
		'https://web.push.apple.com/abc',
		'https://wns2-par02p.notify.windows.com/w/?token=abc'
	])('accepts %s', (endpoint) => {
		expect(isPushEndpoint(endpoint)).toBe(true);
	});

	it.each([
		['plain http', 'http://fcm.googleapis.com/fcm/send/abc'],
		['another host', 'https://example.org/push'],
		['a host that only starts like one', 'https://fcm.googleapis.com.example.org/x'],
		['a host that only ends like one', 'https://evilpush.apple.com/x'],
		['a port', 'https://fcm.googleapis.com:8443/x'],
		['credentials', 'https://user@fcm.googleapis.com/x'],
		['not an address', 'fcm.googleapis.com'],
		['not a string', 42]
	])('refuses %s', (_label, endpoint) => {
		expect(isPushEndpoint(endpoint)).toBe(false);
	});
});

describe('parseSubscription', () => {
	const keys = { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) };
	const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';

	it('reads what the browser sends', () => {
		expect(parseSubscription({ endpoint, expirationTime: null, keys })).toEqual({
			endpoint,
			p256dh: keys.p256dh,
			auth: keys.auth
		});
	});

	it.each([
		['nothing', null],
		['no keys', { endpoint }],
		['an endpoint that is no push service', { endpoint: 'https://example.org/x', keys }],
		['a key that is not base64url', { endpoint, keys: { ...keys, p256dh: '='.repeat(87) } }],
		['a key of the wrong length', { endpoint, keys: { ...keys, auth: 'short' } }]
	])('refuses %s', (_label, body) => {
		expect(parseSubscription(body)).toBeNull();
	});
});

describe('safeEqual', () => {
	it('is true only for the same text', async () => {
		expect(await safeEqual('Bearer abc', 'Bearer abc')).toBe(true);
		expect(await safeEqual('Bearer abc', 'Bearer abd')).toBe(false);
		expect(await safeEqual('', 'Bearer abc')).toBe(false);
	});
});

describe('buildPushMessage', () => {
	it("names one piece of homework for the student, with the student's own page", () => {
		expect(buildPushMessage('added', [target()], 'en')).toEqual({
			title: 'New homework',
			body: 'Beginners: Read chapter 3, due October 11',
			url: '/student/homework',
			tag: `homework-added-${INSTANCE}`,
			lang: 'en'
		});
	});

	it("names the child for a parent, in the browser's language and the class's name in it", () => {
		const message = buildPushMessage('due_soon', [target({ recipient_id: PARENT })], 'de');
		expect(message).toMatchObject({
			title: 'Tenzin: Hausaufgabe bald fällig',
			body: 'Anfänger: Read chapter 3, fällig am 11. Oktober',
			url: '/parent/homework',
			lang: 'de'
		});
	});

	it('says an overdue piece was due', () => {
		const message = buildPushMessage('overdue', [target({ recipient_id: PARENT })], 'en');
		expect(message.title).toBe('Tenzin: homework overdue');
		expect(message.body).toBe('Beginners: Read chapter 3, was due October 11');
	});

	it('falls back to the English class name and writes Tibetan dates', () => {
		const message = buildPushMessage('added', [target()], 'bo');
		expect(message.title).toBe('ནང་སྦྱོང་གསར་པ།');
		expect(message.body).toContain('Beginners');
		expect(message.body).toContain('༡༡');
	});

	it('names both children when one piece of homework is theirs', () => {
		const rows = [
			target({ recipient_id: PARENT }),
			target({ recipient_id: PARENT, student_id: SIBLING, student_name: 'Pema' })
		];
		expect(buildPushMessage('added', rows, 'en').title).toBe('New homework for Tenzin, Pema');
	});

	it('lists several pieces under a plain title, three at most', () => {
		const rows = [1, 2, 3, 4, 5].map((n) =>
			target({
				recipient_id: PARENT,
				instance_id: `10000000-0000-4000-8000-00000000000${n}`,
				title: `Task ${n}`
			})
		);
		expect(buildPushMessage('due_soon', rows, 'en')).toEqual({
			title: 'Homework due soon',
			body: 'Tenzin: Task 1\nTenzin: Task 2\nTenzin: Task 3\n+2 more',
			url: '/parent/homework',
			tag: 'homework-due_soon',
			lang: 'en'
		});
	});

	it("leaves the name out of a student's own list", () => {
		const rows = [1, 2].map((n) =>
			target({ instance_id: `10000000-0000-4000-8000-00000000000${n}`, title: `Task ${n}` })
		);
		expect(buildPushMessage('due_soon', rows, 'en').body).toBe('Task 1\nTask 2');
	});

	it('shortens a very long title', () => {
		const message = buildPushMessage('added', [target({ title: 'x'.repeat(300) })], 'en');
		expect(message.body.length).toBeLessThan(140);
		expect(message.body).toContain('…');
	});
});

describe('sendHomeworkPush', () => {
	it('does nothing while the feature is off', async () => {
		const { admin, calls } = fakeAdmin({ targets: [target()], subscriptions: [] });
		const { send } = fakeSend();
		const result = await sendHomeworkPush('added', {}, { config: null, admin, send });
		expect(result).toMatchObject({ sent: 0, remaining: false });
		expect(calls.rpc).toEqual([]);
		expect(send).not.toHaveBeenCalled();
	});

	it("sends to every browser of a recipient in that browser's language and logs the notice", async () => {
		const phone = subscription(PARENT, { locale: 'de' });
		const laptop = subscription(PARENT, { locale: 'en' });
		const { admin, calls } = fakeAdmin({
			targets: [target({ recipient_id: PARENT })],
			subscriptions: [phone, laptop]
		});
		const { send, sent } = fakeSend();

		const result = await sendHomeworkPush(
			'added',
			{ instanceId: INSTANCE },
			{ config, admin, send }
		);

		expect(result).toEqual({ recipients: 1, sent: 2, removed: 0, failed: 0, remaining: false });
		expect(calls.rpc[0]).toEqual({
			name: 'homework_push_targets',
			args: { p_kind: 'added', p_instance_id: INSTANCE }
		});
		expect(sent.map((s) => [s.endpoint, s.message.title]).sort()).toEqual(
			[
				[phone.endpoint, 'Neue Hausaufgabe für Tenzin'],
				[laptop.endpoint, 'New homework for Tenzin']
			].sort()
		);
		expect(calls.logged).toEqual([
			[{ kind: 'added', instance_id: INSTANCE, student_id: STUDENT, recipient_id: PARENT }]
		]);
		expect(calls.deleted).toEqual([]);
	});

	it('deletes a subscription the push service no longer knows and does not log an undelivered notice', async () => {
		const gone = subscription(STUDENT);
		const { admin, calls } = fakeAdmin({ targets: [target()], subscriptions: [gone] });
		const { send } = fakeSend({ [gone.endpoint]: 410 });

		const result = await sendHomeworkPush('due_soon', {}, { config, admin, send });

		expect(result).toMatchObject({ recipients: 0, sent: 0, removed: 1, failed: 0 });
		expect(calls.deleted).toEqual([[gone.id]]);
		expect(calls.logged).toEqual([]);
	});

	it('logs the notice when one of two browsers got it', async () => {
		const gone = subscription(STUDENT);
		const live = subscription(STUDENT);
		const { admin, calls } = fakeAdmin({ targets: [target()], subscriptions: [gone, live] });
		const { send } = fakeSend({ [gone.endpoint]: 404 });

		const result = await sendHomeworkPush('due_soon', {}, { config, admin, send });

		expect(result).toMatchObject({ recipients: 1, sent: 1, removed: 1 });
		expect(calls.logged).toHaveLength(1);
	});

	it('keeps the subscription and leaves the notice owed on any other failure', async () => {
		const busy = subscription(STUDENT);
		const offline = subscription(PARENT);
		const { admin, calls } = fakeAdmin({
			targets: [target(), target({ recipient_id: PARENT })],
			subscriptions: [busy, offline]
		});
		const { send } = fakeSend({ [busy.endpoint]: 503, [offline.endpoint]: new Error('timeout') });
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await sendHomeworkPush('due_soon', {}, { config, admin, send });

		expect(result).toMatchObject({ recipients: 0, sent: 0, removed: 0, failed: 2 });
		expect(calls.deleted).toEqual([]);
		expect(calls.logged).toEqual([]);
		// The endpoint is a secret address and stays out of the log.
		expect(JSON.stringify(logged.mock.calls)).not.toContain('fcm.googleapis.com');
		logged.mockRestore();
	});

	it('never posts to an address that is no push service, and drops that subscription', async () => {
		const forged = subscription(STUDENT, { endpoint: 'https://example.org/collect' });
		const { admin, calls } = fakeAdmin({ targets: [target()], subscriptions: [forged] });
		const { send } = fakeSend();

		const result = await sendHomeworkPush('added', {}, { config, admin, send });

		expect(send).not.toHaveBeenCalled();
		expect(result).toMatchObject({ sent: 0, removed: 1 });
		expect(calls.deleted).toEqual([[forged.id]]);
	});

	it('sends one batch and reports that more is owed', async () => {
		const ids = [STUDENT, SIBLING, PARENT];
		const subscriptions = ids.map((id) => subscription(id));
		const { admin, calls } = fakeAdmin({
			targets: ids.map((id) => target({ recipient_id: id, student_id: id })),
			subscriptions
		});
		const { send, sent } = fakeSend();

		// Start at the second recipient: the batch is SIBLING and PARENT.
		const result = await sendHomeworkPush(
			'due_soon',
			{ maxSends: 2 },
			{ config, admin, send, rotate: () => 1 }
		);

		expect(result).toMatchObject({ recipients: 2, sent: 2, remaining: true });
		expect(sent.map((s) => s.endpoint).sort()).toEqual(
			[subscriptions[1].endpoint, subscriptions[2].endpoint].sort()
		);
		expect(calls.logged[0].map((row) => row.recipient_id).sort()).toEqual([SIBLING, PARENT].sort());
	});

	it('does not split a recipient across batches', async () => {
		const subscriptions = [subscription(STUDENT), subscription(PARENT), subscription(PARENT)];
		const { admin } = fakeAdmin({
			targets: [target(), target({ recipient_id: PARENT })],
			subscriptions
		});
		const { send, sent } = fakeSend();

		const result = await sendHomeworkPush('due_soon', { maxSends: 2 }, { config, admin, send });

		// The student fits; the parent's two browsers would make three.
		expect(sent.map((s) => s.endpoint)).toEqual([subscriptions[0].endpoint]);
		expect(result).toMatchObject({ recipients: 1, sent: 1, remaining: true });
	});

	it('sends nothing with no room left in the batch', async () => {
		const { admin, calls } = fakeAdmin({
			targets: [target()],
			subscriptions: [subscription(STUDENT)]
		});
		const { send } = fakeSend();
		await sendHomeworkPush('due_soon', { maxSends: 0 }, { config, admin, send });
		expect(calls.rpc).toEqual([]);
		expect(send).not.toHaveBeenCalled();
	});
});

describe('runHomeworkPush', () => {
	const saturday = new Date('2026-10-10T07:00:00Z');
	const friday = new Date('2026-10-09T07:00:00Z');

	function scheduled() {
		const overdue = target({ recipient_id: PARENT });
		const dueSoon = target({ instance_id: '10000000-0000-4000-8000-000000000002' });
		const { admin, calls } = fakeAdmin({
			targets: (kind) => (kind === 'overdue' ? [overdue] : kind === 'due_soon' ? [dueSoon] : []),
			subscriptions: [subscription(STUDENT), subscription(PARENT)]
		});
		const { send, sent } = fakeSend();
		return { deps: { config, admin, send }, calls, sent };
	}

	it('on a Saturday sends Overdue and Due soon', async () => {
		const { deps, sent } = scheduled();
		const result = await runHomeworkPush(null, { ...deps, now: saturday });
		expect(result.overdue).toMatchObject({ sent: 1 });
		expect(result.dueSoon).toMatchObject({ sent: 1 });
		expect(sent.map((s) => s.message.title).sort()).toEqual([
			'Homework due soon',
			'Tenzin: homework overdue'
		]);
	});

	it('on any other day sends Overdue only', async () => {
		const { deps, calls, sent } = scheduled();
		const result = await runHomeworkPush({}, { ...deps, now: friday });
		expect(result.dueSoon).toBeNull();
		expect(sent.map((s) => s.message.title)).toEqual(['Tenzin: homework overdue']);
		expect(calls.rpc.map((c) => c.args.p_kind)).toEqual(['overdue']);
	});

	it('goes by the day in Berlin, not in UTC', async () => {
		// Friday 23:30 UTC is already Saturday in Berlin.
		const { deps } = scheduled();
		const result = await runHomeworkPush(null, { ...deps, now: new Date('2026-10-09T23:30:00Z') });
		expect(result.dueSoon).not.toBeNull();
	});

	it('announces new homework and asks for the next batch while recipients are left', async () => {
		const many = Array.from({ length: 25 }, (_, i) => {
			const id = `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
			return { id, sub: subscription(id) };
		});
		const { admin, calls } = fakeAdmin({
			targets: many.map(({ id }) => target({ recipient_id: id, student_id: id })),
			subscriptions: many.map(({ sub }) => sub)
		});
		const { send } = fakeSend();

		const result = await runHomeworkPush(
			{ kind: 'added', instanceId: INSTANCE, depth: 2 },
			{ config, admin, send }
		);

		expect(result.added).toMatchObject({ sent: 20, remaining: true });
		expect(calls.rpc.at(-1)).toEqual({
			name: 'trigger_homework_push',
			args: { p_kind: 'added', p_instance_id: INSTANCE, p_depth: 3 }
		});
	});

	it('stops asking at the depth limit', async () => {
		const many = Array.from({ length: 25 }, (_, i) => {
			const id = `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
			return { id, sub: subscription(id) };
		});
		const { admin, calls } = fakeAdmin({
			targets: many.map(({ id }) => target({ recipient_id: id, student_id: id })),
			subscriptions: many.map(({ sub }) => sub)
		});
		const { send } = fakeSend();

		await runHomeworkPush(
			{ kind: 'added', instanceId: INSTANCE, depth: PUSH_MAX_DEPTH },
			{ config, admin, send }
		);

		expect(calls.rpc.map((c) => c.name)).toEqual(['homework_push_targets']);
	});

	it('does not ask again when everyone was reached', async () => {
		const { admin, calls } = fakeAdmin({
			targets: [target()],
			subscriptions: [subscription(STUDENT)]
		});
		const { send } = fakeSend();
		await runHomeworkPush({ kind: 'added', instanceId: INSTANCE }, { config, admin, send });
		expect(calls.rpc.map((c) => c.name)).toEqual(['homework_push_targets']);
	});

	it('ignores an "added" request without a real instance id', async () => {
		const { admin, calls } = fakeAdmin({ targets: [target()], subscriptions: [] });
		const { send } = fakeSend();
		const result = await runHomeworkPush(
			{ kind: 'added', instanceId: "x' or 1=1" },
			{ config, admin, send }
		);
		expect(result).toEqual({});
		expect(calls.rpc).toEqual([]);
	});
});

describe('announceHomework', () => {
	it('hands the new homework to the database job', async () => {
		const { admin, calls } = fakeAdmin({ targets: [], subscriptions: [] });
		await announceHomework(INSTANCE, { config, admin });
		expect(calls.rpc).toEqual([
			{ name: 'trigger_homework_push', args: { p_kind: 'added', p_instance_id: INSTANCE } }
		]);
	});

	it('does nothing while the feature is off', async () => {
		const { admin, calls } = fakeAdmin({ targets: [], subscriptions: [] });
		await announceHomework(INSTANCE, { config: null, admin });
		expect(calls.rpc).toEqual([]);
	});

	it('never throws into the action that created the homework', async () => {
		const admin = {
			rpc: async () => {
				throw new Error('network down');
			}
		} as unknown as NonNullable<PushDeps['admin']>;
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(announceHomework(INSTANCE, { config, admin })).resolves.toBeUndefined();
		logged.mockRestore();
	});
});
