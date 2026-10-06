import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { runHomeworkPush, safeEqual, type PushRunRequest } from '$lib/server/push';
import type { RequestHandler } from './$types';

/**
 * Sends the homework notices that are owed (#92). Called by the database
 * (`trigger_homework_push`, 0037): every 5 minutes through the morning, and
 * once when a teacher creates homework. The caller proves itself with the
 * shared secret `PUSH_CRON_SECRET`; without one set, every call is refused.
 *
 * On Cloudflare the work continues after the reply (`waitUntil`): the
 * database's HTTP client gives up after a few seconds, and a dropped
 * connection would otherwise cancel the sending halfway.
 */
export const POST: RequestHandler = async ({ request, platform }) => {
	const secret = env.PUSH_CRON_SECRET?.trim();
	const authorization = request.headers.get('authorization') ?? '';
	if (!secret || !(await safeEqual(authorization, `Bearer ${secret}`))) {
		return json({ error: 'unauthorized' }, { status: 401 });
	}

	const body = (await request.json().catch(() => null)) as PushRunRequest;
	const work = runHomeworkPush(body);

	if (platform?.ctx) {
		platform.ctx.waitUntil(work.catch((err) => console.error('push: run failed', String(err))));
		return json({ accepted: true }, { status: 202 });
	}
	return json(await work);
};
