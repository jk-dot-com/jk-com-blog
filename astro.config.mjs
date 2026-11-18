import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { d1, r2, sandbox } from "@emdash-cms/cloudflare";
import { cloudflareEmail } from "@emdash-cms/cloudflare/plugins";
import { embedsPlugin } from "@emdash-cms/plugin-embeds";
import { aiSearch } from "@emdash-cms/plugin-ai-search";
import seo from "@moorage/plugin-seo";
import siteHealth from "@moorage/plugin-site-health";
import indexnow from "@tagperfect/emdash-plugin-indexnow";
import { formsPlugin } from "@emdash-cms/plugin-forms";
import webhookNotifier from "@emdash-cms/plugin-webhook-notifier";
import { defineConfig, fontProviders } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: d1({ binding: "DB", session: "auto" }),
			storage: r2({ binding: "MEDIA" }),
			plugins: [
				formsPlugin(),
				// Cloudflare Email Sending; the sender must be on a domain onboarded under Email Service.
				cloudflareEmail({
					from: { email: "cms@mail.jaysonknight.com", name: "JK.com Blog" },
					replyTo: "jayson.knight@jaysonknight.com",
				}),
				// Native plugins: they need React admin pages, Astro renderers, or direct runtime access.
				aiSearch(),
				embedsPlugin(),
			],
			// Sandboxed plugins run in isolated Dynamic Workers (needs Workers Paid + the LOADER binding).
			sandboxed: [seo, siteHealth, indexnow, webhookNotifier],
			sandboxRunner: sandbox(),
			marketplace: "https://marketplace.emdashcms.com",
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Space Grotesk",
			cssVariable: "--font-heading",
			weights: [400, 500, 600, 700],
			fallbacks: ["system-ui", "sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500, 700],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
