const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

for (const file of ['index.html', 'styles.css', 'script.js', 'cloud.js', 'config.js', 'build-config.cjs', 'package.json', 'accessories.js', 'supabase/migrations/20261031111600_add_accessory_spk_module.sql']) {
  assert.ok(fs.existsSync(path.join(root, file)), 'Missing required file: ' + file);
}

const html = read('index.html');
const css = read('styles.css');
const script = read('script.js');
const cloud = read('cloud.js');
const accessories = read('accessories.js');
const accessoryMigration = read('supabase/migrations/20261031111600_add_accessory_spk_module.sql');
const config = read('config.js');
const build = read('build-config.cjs');
const migration = read('supabase/migrations/20261028074039_initial_spk_generator_schema.sql');
const pkg = JSON.parse(read('package.json'));

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.ok(ids.length > 0, 'No HTML element IDs found');
assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML IDs found');

assert.match(html, /id="spkPageTab"/);
assert.match(html, /id="accessoryPageTab"/);
assert.match(html, /id="accessoryPage"/);
assert.match(html, /src="accessories\.js"/);
const selectorIds = source => [...source.matchAll(/\$\(\s*["']#([\w-]+)["']\s*\)/g)].map(match => match[1]);
const availableIds = new Set(ids);
const missingSelectors = [...new Set([...selectorIds(script), ...selectorIds(cloud), ...selectorIds(accessories)])]
  .filter(id => !availableIds.has(id));
assert.deepEqual(missingSelectors, [], 'JavaScript references HTML IDs that do not exist');

assert.match(html, /href=["']styles\.css["']/, 'Stylesheet link is missing');
const configIndex = html.indexOf('src="config.js"');
const cloudIndex = html.search(/src="cloud\.js(?:\?[^\"]*)?"/);
const accessoriesIndex = html.indexOf('src="accessories.js"');
const scriptIndex = html.indexOf('src="script.js"');
assert.ok(configIndex >= 0 && configIndex < cloudIndex && cloudIndex < accessoriesIndex && accessoriesIndex < scriptIndex,
  'Client scripts must load in config.js -> cloud.js -> accessories.js -> script.js order');
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

assert.match(accessories, /const TABLE = "accessory_spk_records"/);
assert.match(accessories, /getWorkspaceId\?\./, 'Accessory records must use the active shared workspace');
assert.match(accessories, /\.eq\("workspace_id", context\.workspaceId\)/, 'Accessory reads must be scoped to the active workspace');
assert.match(accessories, /\.eq\("version", state\.version\)/, 'Accessory updates must detect concurrent edits');
assert.match(accessories, /\.is\("deleted_at", null\)/, 'Archived accessory SPKs must not appear in the active list');
assert.match(accessories, /accessories\//, 'Accessory reference files must use a dedicated private Storage path');
assert.match(accessoryMigration, /alter table public\.accessory_spk_records enable row level security/);
assert.match(accessoryMigration, /private\.is_workspace_member\(workspace_id\)/);
assert.match(accessoryMigration, /revoke all on table public\.accessory_spk_records from public, anon/);
assert.match(build, /'accessories\.js'/, 'GitHub Pages build must include the accessory module');
for (const source of [html, script, cloud, accessories, config, build]) {
  assert.doesNotMatch(source, /service_role\s*[:=]\s*['"]|sb_secret_[A-Za-z0-9_-]+/i,
    'A server-only Supabase credential must never appear in client code');
}
assert.match(config, /window\.SPK_CONFIG/, 'Local config fallback is missing');
assert.match(build, /SUPABASE_URL/, 'Build must read SUPABASE_URL');
assert.match(build, /SUPABASE_ANON_KEY/, 'Build must read SUPABASE_ANON_KEY');
assert.equal(pkg.scripts?.build, 'node build-config.cjs', 'Unexpected build command');

const accessoryPrintStart = css.lastIndexOf('@media print {');
const accessoryPrintEnd = css.indexOf('\n@media (max-width: 980px)', accessoryPrintStart);
const accessoryPrintCss = css.slice(accessoryPrintStart, accessoryPrintEnd < 0 ? undefined : accessoryPrintEnd);
const printRuleBody = (source, selector) => {
  const selectorIndex = source.indexOf(selector);
  assert.ok(selectorIndex >= 0, 'Missing print selector: ' + selector);
  const openingBrace = source.indexOf('{', selectorIndex);
  const closingBrace = source.indexOf('}', openingBrace);
  assert.ok(openingBrace >= 0 && closingBrace > openingBrace, 'Malformed print rule: ' + selector);
  return source.slice(openingBrace + 1, closingBrace);
};

assert.match(accessoryPrintCss, /@page accessory-a4 \{ size: A4 portrait; margin: 10mm; \}/,
  'Accessory print must use its own A4 portrait page with standard 10mm margins');
assert.doesNotMatch(accessoryPrintCss, /@page\s*\{/,
  'Accessory print page settings must not override the original SPK page');
const accessoryDocumentRule = printRuleBody(accessoryPrintCss, 'body.accessory-mode #accessoryPrintDocument');
assert.match(accessoryDocumentRule, /page:\s*accessory-a4;/, 'Accessory document must use the named A4 page');
assert.match(accessoryDocumentRule, /width:\s*100%;/, 'Accessory document must fill only its available page width');
assert.match(accessoryDocumentRule, /max-width:\s*190mm;/, 'Accessory document must fit the A4 content box');
assert.match(accessoryDocumentRule, /box-sizing:\s*border-box;/, 'Accessory width must include its box sizing');
assert.match(accessoryDocumentRule, /overflow-wrap:\s*anywhere;/, 'Long accessory text must wrap');
assert.match(accessoryPrintCss, /body\.accessory-mode \.app\s*,[\s\S]*?body\.accessory-mode \.accessory-page-head/,
  'Printing accessories must hide the original jersey and batik SPK page');
assert.match(accessoryPrintCss, /body\.accessory-mode \.accessory-preview-card\s*\{[^}]*padding:\s*0 !important;[^}]*border:\s*0 !important;[^}]*box-shadow:\s*none !important;/s,
  'Accessory print cards must not add screen padding, borders, or shadows');
const accessoryTableRule = printRuleBody(accessoryPrintCss, 'body.accessory-mode .accessory-print-table {');
assert.match(accessoryTableRule, /width:\s*100%;/, 'Accessory table must use the content width');
assert.match(accessoryTableRule, /max-width:\s*100%;/, 'Accessory table must not overflow horizontally');
assert.match(accessoryTableRule, /table-layout:\s*fixed;/, 'Accessory table must use fixed layout');
assert.match(html, /<colgroup>\s*<col style="width: 7%">\s*<col style="width: 28%">\s*<col style="width: 49%">\s*<col style="width: 16%">\s*<\/colgroup>/,
  'Accessory table must define column widths that fit the page');
assert.match(accessoryPrintCss, /body\.accessory-mode \.accessory-print-table thead\s*\{\s*display:\s*table-header-group;\s*\}/,
  'Accessory table headers must repeat across printed pages');
assert.match(accessoryPrintCss, /body\.accessory-mode \.accessory-print-table tbody tr\s*\{[^}]*break-inside:\s*avoid;[^}]*page-break-inside:\s*avoid;/s,
  'Accessory table rows should stay together when they fit on a page');
const accessoryTableCellRule = printRuleBody(accessoryPrintCss, 'body.accessory-mode .accessory-print-table th,');
assert.match(accessoryTableCellRule, /white-space:\s*normal;/, 'Accessory table cells must allow line wrapping');
assert.match(accessoryTableCellRule, /overflow-wrap:\s*anywhere;/, 'Long text inside accessory table cells must wrap');
assert.match(accessoryPrintCss, /body\.accessory-mode \.accessory-document-section\s*\{[^}]*break-inside:\s*auto;[^}]*page-break-inside:\s*auto;/s,
  'Long accessory sections and item tables must be allowed to paginate');
assert.match(accessoryPrintCss, /body\.accessory-mode \.accessory-reference-frame img\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*max-height:\s*60mm;[^}]*object-fit:\s*contain;/s,
  'Accessory reference images must fit the page without cropping');
assert.match(accessoryPrintCss, /body\.accessory-mode \.accessory-document-approval\s*\{[^}]*break-inside:\s*avoid;[^}]*page-break-inside:\s*avoid;/s,
  'Accessory approval signatures should stay together');
assert.match(html, /<img src="https:\/\/cdn\.phototourl\.com\/member\/2026-10-31-b2772341-83fd-435a-908f-09eaa9434ec4\.png" alt="Logo UNITEE">/,
  'Accessory document must use the supplied UNITEE logo');
assert.match(css, /\.accessory-document-brand img\s*\{[^}]*max-width:\s*100%;[^}]*max-height:\s*15mm;[^}]*object-fit:\s*contain;/s,
  'UNITEE logo must fit the accessory document without distortion');
assert.match(accessoryPrintCss, /body\.accessory-mode \.accessory-document-brand img\s*\{[^}]*max-width:\s*100%;[^}]*max-height:\s*15mm;/s,
  'UNITEE logo must stay within the accessory print width');
assert.match(accessoryPrintCss, /body\.accessory-mode \.accessory-signatures > div\s*\{[^}]*min-height:\s*24mm;/s,
  'Accessory signature blocks must remain compact');
assert.doesNotMatch(accessoryPrintCss, /height:\s*297mm|transform:\s*scale/i,
  'Accessory print must paginate vertically without fixed-height scaling');
assert.ok(html.indexOf('src="accessories.js"') < html.indexOf('src="script.js"'),
  'Accessory script must load before the original SPK script');
assert.ok(pkg.scripts?.check?.includes('node --check accessories.js'),
  'The accessory module must be syntax-checked');
assert.ok(build.includes("'accessories.js'"), 'GitHub Pages build must include the accessory module');

console.log('Static checks passed: UI selectors, A4 accessory pagination, workspace isolation, autosave recovery, and private Supabase access.');



