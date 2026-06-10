import { readFileSync } from 'fs';
import { Parsers } from '../src/parsers.js';

const path = process.argv[2] || 'test/wechat-sample.csv';
const isXlsx = path.endsWith('.xlsx') || path.endsWith('.xls');

const file = {
  name: path.split('/').pop(),
  async arrayBuffer() {
    return readFileSync(path).buffer.slice(
      readFileSync(path).byteOffset,
      readFileSync(path).byteOffset + readFileSync(path).byteLength
    );
  }
};

// FileReader shim for Node
if (isXlsx) {
  const buf = readFileSync(path);
  global.FileReader = class {
    readAsArrayBuffer() {
      setTimeout(() => {
        this.result = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        this.onload?.();
      }, 0);
    }
  };
} else {
  global.FileReader = class {
    readAsText(_, enc) {
      setTimeout(() => {
        this.result = readFileSync(path, 'utf-8');
        this.onload?.();
      }, 0);
    }
  };
}

const { format, records } = await Parsers.parseFile(file, '微信-测试', 'auto');
console.log('format:', format);
console.log('records:', records.length);

if (process.argv[3] === '--dedup-db') {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync('data/ledger.db');
  const all = db.prepare('SELECT body FROM transactions').all().map(r => JSON.parse(r.body));
  const dedupSet = Parsers.buildDedupSet(all);
  let dup = 0;
  for (const r of records) if (Parsers.isDuplicate(r, dedupSet)) dup++;
  console.log('duplicates vs DB:', dup, 'new:', records.length - dup);
}
