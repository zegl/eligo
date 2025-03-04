import adapter from '@sveltejs/adapter-vercel';
import preprocess from 'svelte-preprocess';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: [
		preprocess({
			postcss: true,
			typescript: true,
			replace: [
				['import.meta.env.VERCEL_ANALYTICS_ID', JSON.stringify(process.env.VERCEL_ANALYTICS_ID)]
			]
		})
	],
	kit: {
		adapter: adapter(),
		serviceWorker: {
			register: false
		}
	}
};

export default config;
