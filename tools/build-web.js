// Builds the web (PWA) version of Sakina into dist-web/ for GitHub Pages.
// iPhone and Android users open the link and "Add to Home Screen"; the service worker keeps it working offline.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = path.join(root, 'app');
const out = path.join(root, 'dist-web');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

const files = [];
const hash = crypto.createHash('sha256');
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else {
      const rel = path.relative(out, full).split(path.sep).join('/');
      if (rel === 'img/tray.png') continue;
      files.push(rel);
      hash.update(rel).update(fs.readFileSync(full));
    }
  }
})(out);

const version = hash.digest('hex').slice(0, 12);
const sw = fs.readFileSync(path.join(__dirname, 'sw.template.js'), 'utf8')
  .replace('__VERSION__', version)
  .replace('__FILES__', JSON.stringify(['./', ...files]));
fs.writeFileSync(path.join(out, 'sw.js'), sw);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`dist-web: ${files.length} files, version ${version}`);
