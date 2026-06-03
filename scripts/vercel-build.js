const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'web');
const out = path.join(__dirname, '..', 'public');

if (fs.existsSync(out)) fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
console.log('Build OK: web → public');
