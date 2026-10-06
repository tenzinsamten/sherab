import { json } from '@sveltejs/kit';
import { getLocale } from '$lib/paraglide/runtime';
import { isPushEndpoint, parseSubscription } from '$lib/server/push';
import type { RequestHandler } from './$types';

/**
 * This browser's push subscription (#92), for the signed-in student or
 * approved parent. The RPCs (0037) decide who may; this only checks the
 * shape and that the endpoint is a real push service.
 *
 * POST saves it for the caller, with the language the app is shown in here
 * (a scheduled notice has no cookie to read it from). An endpoint another
 * account saved moves to the caller: a shared phone notifies whoever is
 * signed in. DELETE removes the caller's own.
 */
export const POST: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'unauthorized' }, { status: 401 });

	const subscription = parseSubscription(await request.json().catch(() => null));
	if (!subscription) return json({ error: 'invalid' }, { status: 400 });

	const { error } = await supabase.rpc('save_push_subscription', {
		p_endpoint: subscription.endpoint,
		p_p256dh: subscription.p256dh,
		p_auth: subscription.auth,
		p_locale: getLocale()
	});
	if (error) {
		// 42501: not a student or an approved parent.
		if (error.code === '42501') return json({ error: 'forbidden' }, { status: 403 });
		console.error('push: failed to save subscription', error.message);
		return json({ error: 'failed' }, { status: 500 });
	}
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, locals: { supabase, safeGetSession } }) => {
	const { user } = await safeGetSession();
	if (!user) return json({ error: 'unauthorized' }, { status: 401 });

	const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
	if (!isPushEndpoint(body?.endpoint)) return json({ error: 'invalid' }, { status: 400 });

	const { error } = await supabase.rpc('delete_push_subscription', {
		p_endpoint: body.endpoint
	});
	if (error) {
		console.error('push: failed to delete subscription', error.message);
		return json({ error: 'failed' }, { status: 500 });
	}
	return json({ ok: true });
};
