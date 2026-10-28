const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

if (supabaseUrl && !/^https?:\/\//i.test(supabaseUrl)) {
  throw new Error('SUPABASE_URL must be an absolute http(s) URL.');
}
if (Boolean(supabaseUrl) !== Boolean(supabaseAnonKey)) {
  throw new Error('Set both SUPABASE_URL and SUPABASE_ANON_KEY, or leave both empty for local-only mode.');
}

const outputDir = path.join(root, 'dist');
const publicFiles = ['index.html', 'styles.css', 'script.js', 'cloud.js'];
fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });
for (const file of publicFiles) {
  fs.copyFileSync(path.join(root, file), path.join(outputDir, file));
}
const config = { supabaseUrl, supabaseAnonKey };
fs.writeFileSync(path.join(outputDir, 'config.js'), `/* Generated at build time. Browser key is public/anon only. */\nwindow.SPK_CONFIG = ${JSON.stringify(config, null, 2)};\n`, 'utf8');
if (!supabaseUrl) {
  console.warn('SPK Generator build uses local-only mode: SUPABASE_URL and SUPABASE_ANON_KEY were not set.');
} else {
  console.log('SPK Generator client configuration generated from public Supabase environment variables.');
}
console.log(`Static production files copied to ${path.relative(root, outputDir)}/`);
