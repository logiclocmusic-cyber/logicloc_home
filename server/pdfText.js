import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PDFParse } from 'pdf-parse';

async function withParser(buffer, fn) {
  const parser = new PDFParse({ data: buffer });
  try {
    return await fn(parser);
  } finally {
    await parser.destroy?.();
  }
}

export async function pdfToText(buffer) {
  const result = await withParser(buffer, parser => parser.getText());
  return (result.text || '').trim();
}

/** 发票文字是否含号码/金额等关键字段（用于 PDF 文字层与 OCR 结果） */
export function isInvoiceTextUsable(text) {
  const t = String(text || '').trim();
  if (t.replace(/\s/g, '').length < 40) return false;
  const hasInvoiceNo = /\d{18,22}/.test(t);
  const hasAmount = /(?:¥|￥)\s*[\d,]+\.?\d*|\d+\.\d{2}/.test(t);
  const hasDate = /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(t) || /\d{4}-\d{2}-\d{2}/.test(t);
  const hasCompany = /有限公司|个体工商户|有限责任公司/.test(t);
  return hasInvoiceNo && hasAmount && (hasDate || hasCompany);
}

function tempPaths() {
  const id = randomBytes(8).toString('hex');
  const pdfPath = join(tmpdir(), `inv-${id}.pdf`);
  const pngPrefix = join(tmpdir(), `inv-${id}`);
  return { id, pdfPath, pngPrefix, pngPath: `${pngPrefix}.png` };
}

function cleanup(paths) {
  for (const p of [paths.pdfPath, paths.pngPath]) {
    try { unlinkSync(p); } catch { /* ignore */ }
  }
}

function findPdftoppm() {
  for (const bin of ['pdftoppm', '/usr/bin/pdftoppm']) {
    try {
      execFileSync(bin, ['-v'], { stdio: 'pipe' });
      return bin;
    } catch { /* try next */ }
  }
  return null;
}

function renderWithPoppler(buffer) {
  const pdftoppm = findPdftoppm();
  if (!pdftoppm) return null;
  const paths = tempPaths();
  writeFileSync(paths.pdfPath, buffer);
  try {
    execFileSync(pdftoppm, [
      '-png', '-f', '1', '-l', '1', '-r', '300', '-singlefile',
      paths.pdfPath, paths.pngPrefix
    ], { stdio: 'pipe' });
    return readFileSync(paths.pngPath);
  } finally {
    cleanup(paths);
  }
}

function renderWithQlmanage(buffer) {
  if (process.platform !== 'darwin') return null;
  const paths = tempPaths();
  writeFileSync(paths.pdfPath, buffer);
  try {
    execFileSync('qlmanage', ['-t', '-s', '2400', '-o', tmpdir(), paths.pdfPath], { stdio: 'pipe' });
    const pngPath = join(tmpdir(), `${paths.pdfPath.split('/').pop()}.png`);
    return readFileSync(pngPath);
  } finally {
    cleanup(paths);
    try {
      unlinkSync(join(tmpdir(), `${paths.pdfPath.split('/').pop()}.png`));
    } catch { /* ignore */ }
  }
}

async function renderWithPdfParse(buffer) {
  const result = await withParser(buffer, parser =>
    parser.getScreenshot({ desiredWidth: 3000, firstPage: 1, lastPage: 1, imageDataUrl: false })
  );
  const page = result.pages?.[0];
  if (!page?.data) throw new Error('无法渲染 PDF 页面');
  return page.data;
}

/** 将 PDF 首页渲染为 PNG，供 OCR 使用（扫描件 PDF 文字层通常不可用） */
export async function pdfPageImageForOcr(buffer) {
  const renderers = [
    ['poppler', () => renderWithPoppler(buffer)],
    ['qlmanage', () => renderWithQlmanage(buffer)],
    ['pdf-parse', () => renderWithPdfParse(buffer)],
  ];
  for (const [name, fn] of renderers) {
    try {
      const img = await fn();
      if (img?.length) return img;
    } catch (err) {
      console.warn(`[invoice-scan] ${name} render failed:`, err.message);
    }
  }
  throw new Error('无法渲染 PDF 页面');
}
