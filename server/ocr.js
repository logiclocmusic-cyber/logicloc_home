import { createWorker } from 'tesseract.js';

let workerReady = null;

async function getWorker() {
  if (!workerReady) {
    workerReady = (async () => {
      const worker = await createWorker('chi_sim+eng');
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
