const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'cloud.js'), 'utf8');
const handlers = new Map();
const elements = new Map();
const storage = new Map();
const membershipReads = [];
let startNewCalls = 0;
let currentUserId = 'user-a';
let authListener;
let members = {
  'user-a': [{ workspace_id: 'workspace-a', role: 'admin', status: 'active', workspaces: { id: 'workspace-a', name: 'UNITEE' } }],
  'user-b': []
};

function element(id) {
  if (elements.has(id)) return elements.get(id);
  const value = {
    id, value: '', textContent: '', innerHTML: '', disabled: false, hidden: false,
    children: [], classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(event, callback) { handlers.set(`${id}:${event}`, callback); },
    replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
    setAttribute() {}, removeAttribute() {}, appendChild(child) { this.children.push(child); }
  };
  elements.set(id, value);
  return value;
}

const document = {
  readyState: 'complete',
  body: { classList: { add() {}, remove() {}, toggle() {} } },
  querySelector(selector) { return element(selector.replace(/^#/, '')); },
  querySelectorAll() { return []; },
  createTextNode(text) { return { textContent: text }; },
  createElement(tag) { return element(`created-${tag}-${Math.random()}`); }
};

class Query {
  constructor(table) { this.table = table; this.filters = []; this.selected = ''; }
  select(columns) { this.selected = columns; return this; }
  eq(column, value) { this.filters.push(['eq', column, value]); return this; }
  is(column, value) { this.filters.push(['is', column, value]); return this; }
  order() { return this; }
  range() { return this; }
  in(column, value) { this.filters.push(['in', column, value]); return this; }
  then(resolve, reject) { return Promise.resolve().then(() => resolve({ data: this.result(), error: null }), reject); }
  result() {
    if (this.table === 'workspace_members') {
      const userFilter = this.filters.find(item => item[0] === 'eq' && item[1] === 'user_id');
      const workspaceFilter = this.filters.find(item => item[0] === 'eq' && item[1] === 'workspace_id');
      if (userFilter) {
        membershipReads.push(userFilter[2]);
        return members[userFilter[2]] || [];
      }
      if (workspaceFilter) return Object.values(members).flat().filter(item => item.workspace_id === workspaceFilter[2]);
      return [];
    }
    if (this.table === 'spk_records') {
      const workspaceFilter = this.filters.find(item => item[0] === 'eq' && item[1] === 'workspace_id');
      const allowed = (members[currentUserId] || []).some(item => item.workspace_id === workspaceFilter?.[2]);
      return allowed && workspaceFilter?.[2] === 'workspace-a' ? [{
        id: 'spk-shared-1', workspace_id: 'workspace-a', spk_no: 'SPK-20261031-001', version: 1,
        customer: 'Customer', order_name: 'Order', order_date: null, deadline: null,
        model_kerah: 'V Neck', material: 'Cotton', colour: 'Navy', quantity: 1, notes: '',
        ap_designer: '', ap_cs: '', ap_customer: '', ap_production: '', selected_logo_id: null,
        selected_logo_label: '', selected_logo_storage_path: null, design_storage_path: null,
        design_file_size: 0, design_mime_type: 'image/jpeg', created_at: '2026-10-31T00:00:00Z',
        updated_at: '2026-10-31T00:00:00Z', deleted_at: null
      }] : [];
    }
    if (this.table === 'company_logos' || this.table === 'spk_sizes' || this.table === 'spk_approvals' || this.table === 'spk_design_files') return [];
    return [];
  }
}

const auth = {
  async getSession() { return { data: { session: { user: { id: 'user-a', email: 'a@example.test' } } }, error: null }; },
  onAuthStateChange(callback) { authListener = callback; },
  async signOut() { return { error: null }; }
};
const client = {
  auth,
  from(table) { return new Query(table); },
  async rpc(name) {
    if (name === 'next_spk_number') return { data: 'SPK-20261031-002', error: null };
    return { data: null, error: null };
  },
  storage: { from() { return { async createSignedUrl() { return { data: { signedUrl: 'https://signed.example.test/file' }, error: null }; } }; } }
};
const window = {
  SPK_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'publishable-test-key' },
  supabase: { createClient() { return client; } },
  addEventListener() {},
  dispatchEvent() {},
  SpkApp: {
    startNew() { startNewCalls++; },
    async restoreDraft() {},
    refreshUI() {}
  }
};
const localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); }
};
const context = { window, document, localStorage, console, setTimeout, clearTimeout, CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } }, crypto: { randomUUID: () => 'test-id' }, confirm: () => true };

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

(async () => {
  vm.runInNewContext(source, context, { filename: 'cloud.js' });
  await waitFor(() => window.SpkCloud?.getWorkspaceId() === 'workspace-a', 'Initial session did not load its workspace');
  assert.equal(JSON.parse(storage.get('spk_generator_data_v3')).length, 1, 'Initial member should see the workspace SPK');

  const readsBeforeRefresh = membershipReads.length;
  const resetsBeforeRefresh = startNewCalls;
  authListener('TOKEN_REFRESHED', { user: { id: 'user-a', email: 'a@example.test' } });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(membershipReads.length, readsBeforeRefresh, 'Token refresh must not re-fetch workspace memberships');
  assert.equal(startNewCalls, resetsBeforeRefresh, 'Token refresh must not reset the active SPK form');

  currentUserId = 'user-b';
  authListener('SIGNED_IN', { user: { id: 'user-b', email: 'b@example.test' } });
  await waitFor(() => element('cloudStatus').textContent.includes('belum menjadi anggota'), 'Uninvited account should receive a clear workspace membership message');
  assert.equal(window.SpkCloud.getWorkspaceId(), null, 'An account without membership must not keep the previous workspace active');
  assert.deepEqual(JSON.parse(storage.get('spk_generator_data_v3')), [], 'A different account must not keep seeing the previous account cache');

  members['user-b'] = [{ workspace_id: 'workspace-a', role: 'member', status: 'active', workspaces: { id: 'workspace-a', name: 'UNITEE' } }];
  await handlers.get('refreshWorkspaceBtn:click')();
  await waitFor(() => window.SpkCloud.getWorkspaceId() === 'workspace-a' && JSON.parse(storage.get('spk_generator_data_v3')).length === 1,
    'Refreshing memberships should open the newly shared workspace and load its SPK');
  assert.ok(membershipReads.includes('user-b'), 'Membership refresh should query the currently signed-in account');
  console.log('Cloud regression checks passed: token refresh preserves the form, account switches clear prior cache, and refreshed workspace membership reveals shared SPKs.');
})().catch(error => { console.error(error); process.exitCode = 1; });

