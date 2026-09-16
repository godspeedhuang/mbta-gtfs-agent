import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// Docs-only site over the repo's own markdown. `sync.mjs` copies README / ASSUMPTIONS / AI-USE / docs/*.md into ./docs
// before every build, so the site never drifts from the files reviewers read on GitHub.
const config: Config = {
  title: 'MBTA GTFS Agent',
  tagline: 'Ask the MBTA schedule a question; get an auditable answer.',
  url: 'https://godspeedhuang.github.io',
  baseUrl: '/mbta-gtfs-agent/',
  organizationName: 'godspeedhuang',
  projectName: 'mbta-gtfs-agent',
  trailingSlash: false,
  onBrokenLinks: 'warn',
  markdown: {format: 'detect', mermaid: true},
  themes: ['@docusaurus/theme-mermaid'],
  presets: [
    [
      'classic',
      {
        docs: {path: 'docs', routeBasePath: '/', sidebarPath: './sidebars.ts'},
        blog: false,
        theme: {customCss: './custom.css'},
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    colorMode: {defaultMode: 'dark', respectPrefersColorScheme: true},
    navbar: {
      title: 'MBTA GTFS Agent',
      items: [
        {href: 'https://mbta-gtfs-agent.vercel.app/', label: 'Live demo', position: 'right'},
        {href: 'https://github.com/godspeedhuang/mbta-gtfs-agent', label: 'GitHub', position: 'right'},
      ],
    },
    tableOfContents: {minHeadingLevel: 2, maxHeadingLevel: 3},
  } satisfies Preset.ThemeConfig,
};

export default config;
