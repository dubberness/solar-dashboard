<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<svelte:head>
	<title>Solar</title>
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-title" content="Solar" />
	<meta name="apple-mobile-web-app-status-bar-style" content="default" />
	<meta name="theme-color" content="#f4f3ef" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#121211" media="(prefers-color-scheme: dark)" />
</svelte:head>

{@render children()}
