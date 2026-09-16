// Copy the repo's markdown into ./docs with front matter and links rewritten for the site. Generated; gitignored.
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const out = join(import.meta.dirname, 'docs');
const repo = 'https://github.com/godspeedhuang/mbta-gtfs-agent/blob/main';

// [source relative to repo root, target name, extra front matter]
const pages = [
  ['README.md', 'index', 'slug: /\nsidebar_label: Overview'],
  ['ASSUMPTIONS.md', 'assumptions', ''],
  ['AI-USE.md', 'ai-use', ''],
  ['docs/tech-choices.md', 'tech-choices', ''],
  ['docs/observability-evaluation.md', 'observability-evaluation', ''],
  ['docs/design.md', 'design', ''],
];

rmSync(out, {recursive: true, force: true});
mkdirSync(out);
pages.forEach(([src, name, extra], i) => {
  const md = readFileSync(join(root, src), 'utf8')
    .replace(/\]\(docs\/([\w-]+)\.md/g, '](./$1.md')
    .replace(/\]\(\.\.\/README\.md/g, '](./index.md')
    .replace(/\]\(ASSUMPTIONS\.md/g, '](./assumptions.md')
    .replace(/\]\(AI-USE\.md/g, '](./ai-use.md')
    .replace(/\]\(models\.json\)/g, `](${repo}/models.json)`);
  writeFileSync(join(out, `${name}.md`), `---\nsidebar_position: ${i + 1}\n${extra}\n---\n\n${md}`);
});
console.log(`synced ${pages.length} pages`);
