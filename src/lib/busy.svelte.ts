/**
 * Mobile-first story 11: how many page actions (`createPending` submits,
 * src/lib/pending.svelte.ts) are running app-wide, so the root layout can
 * show its loading bar while one is posting and reloading data. Module
 * state: in practice client-only, because submit functions only run in the
 * browser (the server never counts anything).
 */
let running = $state(0);

export function actionStarted() {
	running += 1;
}

/** Never below 0, so a stray extra end cannot hide the next action. */
export function actionEnded() {
	running = Math.max(0, running - 1);
}

export function runningActions() {
	return running;
}
