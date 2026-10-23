<script lang="ts">
	import { tick, untrack } from 'svelte';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Send from '@lucide/svelte/icons/send';
	import X from '@lucide/svelte/icons/x';
	import { enhance } from '$app/forms';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { showToast } from '$lib/toast';
	import * as m from '$lib/paraglide/messages.js';
	import { createPending } from '$lib/pending.svelte';
	import type { StudentJoinRequest } from '$lib/server/class-join';
	import { ui } from '$lib/ui/classes';

	/**
	 * #67 / #113: the "Join another class" card -- a class code field and the
	 * student's pending / rejected join requests (Dismiss on rejected ones).
	 * Posts to the page's `?/requestJoin` and `?/dismissJoin` actions, so the
	 * page using it must have both (the Classes tab, /student/classes).
	 */
	type JoinForm = {
		joinSent?: string;
		joinDismissed?: boolean;
		joinError?: string;
		code?: string;
	} | null;

	let {
		form,
		joinRequests,
		joinLoadError
	}: { form: JoinForm; joinRequests: StudentJoinRequest[]; joinLoadError: boolean } = $props();

	const pending = createPending();

	// Upper-cased as typed, like /join; cleared after a request is sent. A
	// refused code comes back in form.code (also without JavaScript) and is
	// shown again with its error.
	const refused = (f: JoinForm) =>
		f && 'code' in f && f.joinError ? { code: f.code ?? '', error: String(f.joinError) } : null;
	let joinCode = $state(untrack(() => refused(form)?.code ?? ''));
	let joinCodeError = $state<string | null>(untrack(() => refused(form)?.error ?? null));
	let joinInput = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (!form) return;
		if (form.joinSent) {
			showToast('success', m.student_join_sent({ name: form.joinSent }));
			joinCode = '';
			joinCodeError = null;
		}
		if (form.joinDismissed) showToast('success', m.student_join_dismissed());
		if (form.joinError) {
			// A refused code shows under the field only (announced there by
			// role="alert"), and focus goes back to the field; a failed
			// dismiss has no field, so it's a toast.
			const r = refused(form);
			if (r) {
				joinCode = r.code;
				joinCodeError = r.error;
				void tick().then(() => joinInput?.focus());
			} else {
				showToast('error', form.joinError);
			}
		}
	});
</script>

{#snippet spinner(key: string)}
	{#if pending.is(key)}
		<LoaderCircle class="animate-spin" aria-hidden="true" />
	{/if}
{/snippet}

<section class={ui.card} aria-labelledby="join-heading" data-testid="join-card">
	<h2 id="join-heading" class={ui.cardTitle}>{m.student_join_heading()}</h2>
	<p class="{ui.muted} mb-3">{m.student_join_intro()}</p>
	<!-- novalidate: the server checks the code and answers under the field. -->
	<form
		method="POST"
		action="?/requestJoin"
		novalidate
		class="flex flex-col gap-1.5"
		use:enhance={pending.submit('requestJoin', { reset: false })}
	>
		<label for="joinCode" class="text-sm font-medium">{m.student_join_code_label()}</label>
		<!-- The button sits level with the field whatever the label's height
		     (Tibetan, wrapped German); the error stays under the field. -->
		<div class="flex flex-col gap-3 md:flex-row md:items-start">
			<div class="flex min-w-0 flex-1 flex-col gap-1.5">
				<!-- A refused code posted without JavaScript: focus is on the field. -->
				<Input
					id="joinCode"
					name="code"
					bind:ref={joinInput}
					value={joinCode}
					oninput={(event) => {
						const field = event.currentTarget;
						joinCode = field.value.toUpperCase();
						if (field.value !== joinCode) {
							// Keep the caret where it was (an edit mid-code).
							const { selectionStart, selectionEnd } = field;
							field.value = joinCode;
							field.setSelectionRange(selectionStart, selectionEnd);
						}
						joinCodeError = null;
					}}
					required
					autocomplete="off"
					autocapitalize="characters"
					spellcheck={false}
					autofocus={joinCodeError ? true : undefined}
					class="uppercase"
					aria-invalid={joinCodeError ? 'true' : undefined}
					aria-describedby={joinCodeError ? 'joinCode-error' : undefined}
				/>
				{#if joinCodeError}
					<p id="joinCode-error" class={ui.error} role="alert">{joinCodeError}</p>
				{/if}
			</div>
			<Button
				type="submit"
				class="{ui.touch} w-full md:w-auto"
				disabled={pending.busy}
				aria-busy={pending.is('requestJoin') || undefined}
			>
				{#if pending.is('requestJoin')}
					{@render spinner('requestJoin')}
				{:else}
					<Send aria-hidden="true" />
				{/if}
				{m.student_join_submit()}
			</Button>
		</div>
	</form>

	{#if joinLoadError}
		<p class="{ui.muted} mt-3" role="alert">{m.student_join_load_failed()}</p>
	{:else if joinRequests.length > 0}
		<ul class="{ui.rows} mt-4" data-testid="join-requests">
			{#each joinRequests as req (req.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-2 py-2" data-testid="join-request">
					<Badge variant={req.status === 'pending' ? 'warning' : 'alarm'} data-testid="join-status">
						{req.status === 'pending'
							? m.student_join_status_pending()
							: m.student_join_status_rejected()}
					</Badge>
					<span class="min-w-0 flex-1 wrap-break-word">{req.className}</span>
					{#if req.status === 'rejected'}
						<form
							method="POST"
							action="?/dismissJoin"
							use:enhance={pending.submit(`dismissJoin:${req.id}`)}
						>
							<input type="hidden" name="id" value={req.id} />
							<Button
								type="submit"
								variant="ghost"
								class={ui.touch}
								disabled={pending.busy}
								aria-busy={pending.is(`dismissJoin:${req.id}`) || undefined}
							>
								{#if pending.is(`dismissJoin:${req.id}`)}
									{@render spinner(`dismissJoin:${req.id}`)}
								{:else}
									<X aria-hidden="true" />
								{/if}
								{m.student_join_dismiss()}
							</Button>
						</form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
