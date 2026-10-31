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
const migration = read('supabase/migrations/20261028074039_initial_spk_generator_schema.sql');
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
const cloudIndex = html.search(/src="cloud\.js(?:\?[^\"]*)?"/);
const scriptIndex = html.indexOf('src="script.js"');
assert.ok(configIndex >= 0 && configIndex < cloudIndex && cloudIndex < scriptIndex,
  'Client scripts must load in config.js -> cloud.js -> script.js order');
assert.match(css, /@media\s+print/i, 'Print CSS is missing');
assert.match(script, /async function preparePrintImages\(/, 'Print must wait for document images');
assert.match(script, /images\.map\(image => waitForImageReady\(image\)\)/, 'Print image wait callback must pass the image element');
assert.match(css, /\.spk \.size-list-group\s*\{[^}]*break-inside:\s*avoid/s, 'Print size groups should stay together');
assert.match(css, /\.spk \.approval-section\s*\{[^}]*page-break-inside:\s*avoid/s, 'Approval section should stay together in print');
assert.match(css, /\.spk\s*\{[^}]*display:\s*flex/s, 'Print document should use vertical flex layout');
assert.match(css, /\.spk > \.notes-box\s*\{[^}]*margin-top:\s*auto/s, 'Print notes and approval should sit at the bottom when space allows');
assert.match(css, /\.approval-table div\s*\{[^}]*min-height:\s*12mm/s, 'Print approval rows should be compact');
assert.match(css, /\.spk \.size-list, \.spk \.size-list-heading\s*\{[^}]*font-size:\s*10pt/, 'Print size list should use larger typography');
assert.match(css, /@page \{ size: A4 portrait; margin: 7mm; \}/, 'Print page must stay A4 portrait');
assert.match(css, /\.spk \.design-preview\s*\{\s*flex:\s*0 0 82mm; min-height:\s*82mm; max-height:\s*82mm;/, 'Print design preview should be enlarged and fixed');
assert.match(css, /\.spk \.size-list, \.spk \.size-list-heading\s*\{[^}]*font-weight:\s*700/s, 'Print size details should be bold');
assert.match(css, /\.spk \.size-list-items\s*\{[^}]*font-weight:\s*700/s, 'Print size quantities should be bold');
assert.match(css, /\.detail-layout\s*\{[^}]*flex-direction:\s*column/s, 'Print size breakdown must sit below order details');
assert.match(css, /\.info\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/s, 'Print order details should be arranged horizontally in four columns');
assert.match(css, /\.info > div\s*\{[^}]*align-items:\s*center; justify-content:\s*center;/s, 'Print order details should be centered');
assert.match(css, /\.size-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s, 'Print size groups should be arranged in two consistent columns below order details');
assert.match(css, /\.spk \.size-list-group\s*\{[^}]*border:\s*\.5pt solid/s, 'Print size groups should have consistent card boundaries');
assert.match(css, /\.spk \.size-list-group\s*\{[^}]*text-align:\s*left/s, 'Print size groups should be left-aligned for readability');
assert.match(css, /\.spk \.size-list-items\s*\{[^}]*justify-content:\s*flex-start/s, 'Print size values should start at a consistent left edge');

for (const rpc of ['next_spk_number', 'save_spk', 'delete_spk', 'remove_workspace_member', 'create_workspace', 'add_workspace_member']) {
  assert.ok(cloud.includes(rpc), 'Supabase RPC reference is missing: ' + rpc);
}
for (const table of ['company_logos', 'spk_records', 'spk_sizes', 'spk_approvals', 'spk_design_files', 'workspace_members']) {
  assert.ok(cloud.includes(table), 'Supabase table reference is missing: ' + table);
}
assert.match(cloud, /spk-files/, 'Expected private Supabase Storage bucket reference is missing');
assert.match(html, /id="refreshWorkspaceBtn"/, 'Workspace membership refresh control is missing');
assert.match(html, /id="accountMenuBtn"/, 'Compact workspace menu control is missing');
assert.match(cloud, /ACTIVE_WORKSPACE_KEY/, 'Selected workspace must be remembered per account');
assert.match(cloud, /classList\.toggle\("hidden", cloudActive && !accountPanelOpen\)/,
  'The account panel should collapse after a workspace is active');
assert.match(cloud, /accountMenu\.textContent = cloudActive \? "Akun \/ Login" : "Login"/,
  'The compact menu must make account and login controls visible after sign-in');
assert.match(css, /body\.cloud-active \.mode-notice\s*\{\s*display:none !important;/,
  'The cloud status banner must not take space above the active SPK view');
assert.match(cloud, /event === "TOKEN_REFRESHED"[\s\S]*?return;/, 'Token refresh must not reload memberships or reset the editor');
assert.match(cloud, /CACHE_SOURCE_KEY/, 'Local records and the cloud cache must not be mixed between accounts');
assert.match(cloud, /assertWorkspaceContext\(context\)/, 'Cloud writes must reject account or workspace switches in flight');
assert.match(cloud, /workspaceLoadGeneration === loadGeneration/, 'Stale workspace loads must not replace the active cache');
assert.match(script, /window\.indexedDB\.open/, 'Form drafts need durable browser recovery storage');
assert.match(script, /window\.addEventListener\("pagehide"/, 'Draft recovery must flush when the page closes');
assert.match(script, /persistedFormRevision/, 'Concurrent autosaves must not replay an unchanged form or lose newer edits');
assert.match(script, /Number\(currentRecordVersion \|\| saved\[index\]\.version \|\| 0\)/,
  'A refreshed cloud cache must not replace the version captured by an already-open form');
assert.match(script, /window\.SpkCloud\.saveRecord\(data, \{ workspaceId: snapshot\.workspaceId, userId: snapshot\.userId \}\)/,
  'Cloud saves must be bound to the workspace and account that started the save');
assert.match(migration, /create policy "workspace members can read SPK records"[\s\S]*?private\.is_workspace_member\(workspace_id\)/,
  'SPK record reads must remain restricted to active workspace membership');
assert.match(migration, /values \('spk-files', 'spk-files', false, 15728640\)/,
  'SPK Storage must remain private with its configured size limit');

for (const source of [html, script, cloud, config, build]) {
  assert.doesNotMatch(source, /service_role\s*[:=]\s*['"]|sb_secret_[A-Za-z0-9_-]+/i,
    'A server-only Supabase credential must never appear in client code');
}
assert.match(config, /window\.SPK_CONFIG/, 'Local config fallback is missing');
assert.match(build, /SUPABASE_URL/, 'Build must read SUPABASE_URL');
assert.match(build, /SUPABASE_ANON_KEY/, 'Build must read SUPABASE_ANON_KEY');
assert.equal(pkg.scripts?.build, 'node build-config.cjs', 'Unexpected build command');

console.log('Static checks passed: UI selectors, print layout, workspace isolation, autosave recovery, and private Supabase access.');


