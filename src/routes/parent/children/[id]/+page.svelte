<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import * as m from '$lib/paraglide/messages.js';
	import { getLocale } from '$lib/paraglide/runtime';
	import { showToast } from '$lib/ix';
	import { createPending } from '$lib/pending.svelte';
	import type { ActionData, PageProps } from './$types';

	/**
	 * Story 7-4: a parent's leave page for one approved child. Each upcoming
	 * session shows its current answer and, until it starts, Coming / On
	 * leave. On leave first asks the database how it will count
	 * (preview_leave) and saves only after the parent confirms.
	 */
	let { data, form }: PageProps & { form: ActionData } = $props();

	const pending = createPending();

	// Wall-clock dates: format as UTC so no time zone shifts the day.
	function formatDay(date: string): string {
		try {
			return new Intl.DateTimeFormat(getLocale(), {
				weekday: 'short',
				day: 'numeric',
				month: 'long',
				timeZone: 'UTC'
			}).format(new Date(`${date}T00:00:00Z`));
		} catch {
			return date;
		}
	}

	function answerLabel(answer: string | null): string {
		if (answer === 'coming') return m.leave_answer_coming();
		if (answer === 'on_leave') return m.leave_answer_on_leave();
		if (answer === 'sick') return m.leave_answer_sick();
		return m.leave_answer_none();
	}

	function classificationLabel(classification: string | null): string {
		return classification === 'planned' ? m.leave_class_planned() : m.leave_class_short_notice();
	}

	// The On leave preview waiting for confirmation (one session at a time).
	let preview = $state<{ sessionId: string; classification: 'planned' | 'short_notice' } | null>(
		null
	);
	$effect.pre(() => {
		const f = form as ActionData;
		if (f && 'action' in f && f.action === 'preview') {
			preview = { sessionId: f.sessionId, classification: f.preview };
		} else {
			preview = null;
		}
	});

	let errorFor = $derived(
		form && 'error' in form && form.error
			? { sessionId: form.sessionId, message: form.error }
			: null
	);

	$effect(() => {
		if (form && 'action' in form && form.action === 'setLeave' && form.success) {
			showToast('success', m.leave_saved());
		}
	});
</script>

<svelte:head>
	<title>{data.child.name} — {m.leave_kicker()} — Sherab</title>
</svelte:head>

<div class="page">
	<header class="page-header">
		<div>
			<p class="page-kicker">{m.leave_kicker()}</p>
			<h1 class="page-heading">{data.child.name}</h1>
			<p class="page-subtitle">
				<a href={resolve('/parent')}>{m.leave_back()}</a>
			</p>
		</div>
	</header>

	<section class="card">
		<h2>{m.leave_sessions_label()}</h2>
		<p class="muted">{m.leave_intro()}</p>
		{#if data.loadError}
			<ix-empty-state header={m.load_error_generic()} icon="info"></ix-empty-state>
		{:else if data.sessions.length === 0}
			<ix-empty-state header={m.leave_empty()} icon="calendar"></ix-empty-state>
		{:else}
			<ul class="sessions" aria-label={m.leave_sessions_label()}>
				{#each data.sessions as session (session.id)}
					<li class="session">
						<div class="session-info">
							<p class="session-when">
								<strong><time datetime={session.day}>{formatDay(session.day)}</time></strong>
								<span>
									{session.startTime ?? m.calendar_status_unset()}
									{#if session.durationMinutes}
										· {m.leave_duration({ minutes: session.durationMinutes })}
									{/if}
								</span>
							</p>
							<p class="muted session-class">{session.className}</p>
						</div>
						<div class="session-answer">
							<span class="sr-only">{m.leave_answer_label()}:</span>
							{#if session.answer === 'on_leave'}
								<ix-pill variant="warning">
									{answerLabel(session.answer)} · {classificationLabel(session.classification)}
								</ix-pill>
							{:else if session.answer === 'coming'}
								<ix-pill variant="success" outline>{answerLabel(session.answer)}</ix-pill>
							{:else if session.answer === 'sick'}
								<ix-pill variant="neutral">{answerLabel(session.answer)}</ix-pill>
							{:else}
								<ix-pill variant="neutral" outline>{answerLabel(null)}</ix-pill>
							{/if}
						</div>
						{#if session.open}
							<div class="session-controls">
								{#if preview?.sessionId === session.id}
									<p class="preview" role="status">
										{preview.classification === 'planned'
											? m.leave_preview_planned()
											: m.leave_preview_short_notice()}
									</p>
									<form
										method="POST"
										action="?/setLeave"
										use:enhance={pending.submit(`confirm:${session.id}`)}
										class="inline-form"
									>
										<input type="hidden" name="sessionId" value={session.id} />
										<input type="hidden" name="answer" value="on_leave" />
										<ix-button
											type="submit"
											variant="primary"
											loading={pending.is(`confirm:${session.id}`) || undefined}
											disabled={pending.busy || undefined}
										>
											{m.leave_confirm()}
										</ix-button>
										<ix-button
											variant="tertiary"
											disabled={pending.busy || undefined}
											onclick={() => (preview = null)}
										>
											{m.leave_keep()}
										</ix-button>
									</form>
								{:else}
									<form
										method="POST"
										action="?/setLeave"
										use:enhance={pending.submit(`coming:${session.id}`)}
										class="inline-form"
									>
										<input type="hidden" name="sessionId" value={session.id} />
										<input type="hidden" name="answer" value="coming" />
										<ix-button
											type="submit"
											variant={session.answer === 'coming' ? 'primary' : 'secondary'}
											loading={pending.is(`coming:${session.id}`) || undefined}
											disabled={pending.busy || undefined}
										>
											{m.leave_answer_coming()}
										</ix-button>
									</form>
									<form
										method="POST"
										action="?/preview"
										use:enhance={pending.submit(`preview:${session.id}`)}
										class="inline-form"
									>
										<input type="hidden" name="sessionId" value={session.id} />
										<ix-button
											type="submit"
											variant={session.answer === 'on_leave' ? 'primary' : 'secondary'}
											loading={pending.is(`preview:${session.id}`) || undefined}
											disabled={pending.busy || undefined}
										>
											{m.leave_answer_on_leave()}
										</ix-button>
									</form>
								{/if}
							</div>
						{:else}
							<p class="muted session-started">{m.leave_started()}</p>
						{/if}
						{#if errorFor?.sessionId === session.id}
							<p class="field-error session-error" role="alert">{errorFor.message}</p>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.sessions {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.session {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-2) var(--space-4);
		align-items: center;
		padding: var(--space-3) 0;
		border-bottom: 1px solid var(--theme-color-soft-bdr, rgba(0, 0, 0, 0.1));
	}

	.session:last-child {
		border-bottom: none;
	}

	.session-when {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
	}

	.session-class {
		margin: 0;
	}

	.session-controls,
	.session-started,
	.session-error {
		grid-column: 1 / -1;
		margin: 0;
	}

	.session-controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
	}

	.inline-form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.preview {
		flex-basis: 100%;
		margin: 0;
	}
</style>
