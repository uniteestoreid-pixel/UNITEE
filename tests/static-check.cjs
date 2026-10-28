const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

for (const file of ['index.html', 'styles.css', 'script.js', 'cloud.js', 'config.js', 'build-config.cjs', 'package.json']) {
  assert.ok(fs.existsSync(path.join(root, file)), 'Missing required file: ' + file);
}

const html = read('index.html');
const css = read('styles.css');
const script = read('script.js');
const cloud = read('cloud.js');
const config = read('config.js');
const build = read('build-config.cjs');
const pkg = JSON.parse(read('package.json'));

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.ok(ids.length > 0, 'No HTML element IDs found');
assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML IDs found');

const selectorIds = source => [...source.matchAll(/\$\(\s*["']#([\w-]+)["']\s*\)/g)].map(match => match[1]);
const availableIds = new Set(ids);
const missingSelectors = [...new Set([...selectorIds(script), ...selectorIds(cloud)])]
  .filter(id => !availableIds.has(id));
assert.deepEqual(missingSelectors, [], 'JavaScript references HTML IDs that do not exist');

assert.match(html, /href=["']styles\.css["']/, 'Stylesheet link is missing');
const configIndex = html.indexOf('src="config.js"');
const cloudIndex = html.indexOf('src="cloud.js"');
const scriptIndex = html.indexOf('src="script.js"');
assert.ok(configIndex >= 0 && configIndex < cloudIndex && cloudIndex < scriptIndex,
  'Client scripts must load in config.js -> cloud.js -> script.js order');
assert.match(css, /@media\s+print/i, 'Print CSS is missing');

for (const rpc of ['next_spk_number', 'save_spk', 'delete_spk', 'remove_workspace_member', 'create_workspace', 'add_workspace_member']) {
  assert.ok(cloud.includes(rpc), 'Supabase RPC reference is missing: ' + rpc);
}
for (const table of ['company_logos', 'spk_records', 'spk_sizes', 'spk_approvals', 'spk_design_files', 'workspace_members']) {
  assert.ok(cloud.includes(table), 'Supabase table reference is missing: ' + table);
}
assert.match(cloud, /spk-files/, 'Expected private Supabase Storage bucket reference is missing');

for (const source of [html, script, cloud, config, build]) {
  assert.doesNotMatch(source, /service_role\s*[:=]\s*['"]|sb_secret_[A-Za-z0-9_-]+/i,
    'A server-only Supabase credential must never appear in client code');
}
assert.match(config, /window\.SPK_CONFIG/, 'Local config fallback is missing');
assert.match(build, /SUPABASE_URL/, 'Build must read SUPABASE_URL');
assert.match(build, /SUPABASE_ANON_KEY/, 'Build must read SUPABASE_ANON_KEY');
assert.equal(pkg.scripts?.build, 'node build-config.cjs', 'Unexpected build command');

console.log('Static checks passed: HTML IDs, client selectors, asset order, print CSS, Supabase references, and public-key safety.');
