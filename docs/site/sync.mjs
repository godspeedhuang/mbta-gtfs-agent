// Copy the repo's markdown into ./docs with front matter and links rewritten for the site. Generated; gitignored.
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const out = join(import.meta.dirname, 'docs');
const repo = 'https://github.com/godspeedhuang/mbta-gtfs-agent/blob/main';

// [source relative to repo root, target name, extra front matter]
const pages = [
  ['README.md', 'index', 'slug: /\nsidebar_label: Overview'],
  ['ASSUMPTIONS.md', 'assumptions', ''],
  ['AI-USE.md', 'ai-use', ''],
];

rmSync(out, {recursive: true, force: true});
mkdirSync(out);
// A page whose source isn't committed yet is skipped, so the site still builds.
const present = pages.filter(([src]) => existsSync(join(root, src)) || console.warn(`skip ${src}: not found`));
present.forEach(([src, name, extra], i) => {
  const md = readFileSync(join(root, src), 'utf8')
    .replace(/\]\(docs\/([\w-]+)\.md/g, '](./$1.md')
    .replace(/\]\((\.\.\/)?README\.md/g, '](./index.md')
    .replace(/\]\(ASSUMPTIONS\.md/g, '](./assumptions.md')
    .replace(/\]\(AI-USE\.md/g, '](./ai-use.md')
    .replace(/\]\(models\.json\)/g, `](${repo}/models.json)`)
    // GitHub can't embed video, so the README links a thumbnail; here the same line becomes a player.
    .replace(
      /\[!\[([^\]]*)\]\(https:\/\/img\.youtube\.com\/vi\/([\w-]+)\/[^)]+\)\]\(https:\/\/youtu\.be\/\2\)/g,
      '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/$2" title="$1" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>',
    );
  writeFileSync(join(out, `${name}.md`), `---\nsidebar_position: ${i + 1}\n${extra}\n---\n\n${md}`);
});
console.log(`synced ${present.length} pages`);
