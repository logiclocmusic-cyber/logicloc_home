import { createWorker } from 'tesseract.js';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESS_CACHE = join(__dirname, '..', 'data', 'tesseract-cache');
mkdirSync(TESS_CACHE, { recursive: true });

let workerReady = null;

async function getWorker() {
  if (!workerReady) {
    workerReady = (async () => {
      // chi_sim 已覆盖中文发票；chi_sim+eng 在 tesseract.js v7 会触发多语言包加载异常
      const worker = await createWorker('chi_sim', undefined, { cachePath: TESS_CACHE });
      return worker;
    })();
  }
  return workerReady;
}

export async function imageToText(buffer) {
  const worker = await getWorker();
  const { data: { text } } = await worker.recognize(buffer);
  return (text || '').trim();
}
