<!-- Dev-only preview of the new component system (see +page.server.ts).
     Plain heading, link and table on purpose: inside `data-ui="new"` they
     must show neither iX's nor app.css's element styles. Static strings, no
     translations: this page is never shipped. -->
<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import BookOpenIcon from '@lucide/svelte/icons/book-open';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';

	const samples = [
		{
			lang: 'en',
			heading: 'Sherab components',
			link: 'A plain link',
			button: 'Save',
			cardTitle: 'Homework',
			cardBody: 'Read chapter three and practise the alphabet.',
			rows: [
				['Monday', 'Tibetan'],
				['Sunday', 'Dance']
			]
		},
		{
			lang: 'bo',
			heading: 'ཤེས་རབ།',
			link: 'འབྲེལ་མཐུད།',
			button: 'ཉར་ཚགས།',
			cardTitle: 'ཁྱིམ་ལས།',
			cardBody: 'ལེའུ་གསུམ་པ་ཀློག་དགོས།',
			rows: [
				['གཟའ་ཟླ་བ།', 'བོད་ཡིག'],
				['གཟའ་ཉི་མ།', 'ཞབས་བྲོ།']
			]
		}
	];
</script>

<svelte:head>
	<title>UI preview</title>
</svelte:head>

{#each samples as sample (sample.lang)}
	<section
		data-ui="new"
		lang={sample.lang}
		data-testid="preview-{sample.lang}"
		class="flex flex-col items-start gap-6 p-4"
	>
		<h2 data-testid="plain-heading">{sample.heading}</h2>
		<a href="#top" data-testid="plain-link">{sample.link}</a>
		<!-- Nested language: Tibetan inside English, English inside Tibetan. -->
		{#if sample.lang === 'en'}
			<h3 lang="bo" data-testid="nested-lang">ཤེས་རབ།</h3>
			<!-- Tibetan with no `lang` of its own (a class or team name in an
			     English interface): still drawn in Atisha (#78). -->
			<p data-testid="untagged-bo">ཤེས་རབ།</p>
		{:else}
			<p lang="en" data-testid="nested-lang">Written in English</p>
		{/if}

		<div class="flex flex-wrap items-center gap-2">
			<Button data-testid="button-default">
				<PlusIcon data-testid="lucide-icon" />
				{sample.button}
			</Button>
			<Button variant="outline">{sample.button}</Button>
			<Button variant="secondary">{sample.button}</Button>
			<Button variant="ghost">{sample.button}</Button>
			<Button variant="destructive">{sample.button}</Button>
			<Button variant="link">{sample.button}</Button>
			<Button href="#top" size="lg">{sample.button}</Button>
			<Button size="icon" aria-label={sample.button}><BookOpenIcon /></Button>
		</div>

		<Card.Root class="w-full max-w-sm" data-testid="card">
			<Card.Header>
				<Card.Title>{sample.cardTitle}</Card.Title>
				<Card.Description>{sample.cardBody}</Card.Description>
			</Card.Header>
			<Card.Content>
				<table data-testid="plain-table">
					<tbody>
						{#each sample.rows as row (row[0])}
							<tr>
								{#each row as cell (cell)}
									<td>{cell}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</Card.Content>
			<Card.Footer>
				<Button>{sample.button}</Button>
			</Card.Footer>
		</Card.Root>
	</section>
{/each}

<!-- Outside the root: utilities still apply (they are global); only the
     reset is scoped. -->
<div class="p-4">
	<Button data-testid="button-outside">Outside the root</Button>
</div>
