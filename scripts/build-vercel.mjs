import { access, readFile } from 'node:fs/promises';

for (const path of ['public/index.html', 'public/app.js', 'public/theme.js', 'public/i18n.js', 'public/scoreboard.js', 'public/style.css', 'public/favicon.svg', 'api/index.js']) await access(new URL('../' + path, import.meta.url));
const source = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
if (!source.includes('Word Mine')) throw new Error('Game page is missing.');
console.log('Vercel static assets and API entrypoint are ready.');
