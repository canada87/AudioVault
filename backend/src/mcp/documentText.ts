import * as fs from 'fs';
import * as path from 'path';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import type { Element } from '@xmldom/xmldom';

// Plain-text extraction for project documents, so the model can read them without downloading.
// OOXML formats (docx/pptx/xlsx) are zip archives of XML; PDF goes through pdfjs-dist.

export class UnsupportedDocumentError extends Error {}

// Largest single OOXML part we are willing to inflate (guards against zip bombs).
const MAX_PART_BYTES = 100 * 1024 * 1024;

type XmlNode = ReturnType<DOMParser['parseFromString']>['firstChild'] & object;

function parseXml(bytes: Uint8Array): ReturnType<DOMParser['parseFromString']> {
  return new DOMParser({ onError: () => undefined }).parseFromString(Buffer.from(bytes).toString('utf8'), 'text/xml');
}

function localName(node: XmlNode): string {
  const n = node as unknown as { localName?: string; nodeName: string };
  return n.localName ?? n.nodeName.replace(/^.*:/, '');
}

function children(node: XmlNode): XmlNode[] {
  const out: XmlNode[] = [];
  for (let c = node.firstChild; c; c = c.nextSibling) out.push(c as XmlNode);
  return out;
}

function descendants(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of children(node)) {
    if (c.nodeType !== 1) continue;
    if (localName(c) === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

function textOf(node: XmlNode): string {
  return node.textContent ?? '';
}

function unzipParts(data: Buffer, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(data), {
    filter: (file) => wanted(file.name) && file.originalSize <= MAX_PART_BYTES,
  });
}

// One paragraph per <w:p> / <a:p>; runs are concatenated, tabs and line breaks preserved.
function paragraphText(p: XmlNode): string {
  let out = '';
  const walk = (node: XmlNode): void => {
    for (const c of children(node)) {
      if (c.nodeType !== 1) continue;
      const name = localName(c);
      if (name === 't') out += textOf(c);
      else if (name === 'tab') out += '\t';
      else if (name === 'br') out += '\n';
      else walk(c);
    }
  };
  walk(p);
  return out;
}

function extractDocx(data: Buffer): string {
  const parts = unzipParts(data, (n) => n === 'word/document.xml');
  const xml = parts['word/document.xml'];
  if (!xml) throw new UnsupportedDocumentError('Not a valid .docx file');
  const doc = parseXml(xml);
  const lines = descendants(doc.documentElement as unknown as XmlNode, 'p').map(paragraphText);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function slideNumber(name: string): number {
  return parseInt(/slide(\d+)\.xml$/.exec(name)?.[1] ?? '0', 10);
}

function extractPptx(data: Buffer): string {
  const parts = unzipParts(data, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const names = Object.keys(parts).sort((a, b) => slideNumber(a) - slideNumber(b));
  if (names.length === 0) throw new UnsupportedDocumentError('Not a valid .pptx file');

  return names
    .map((name) => {
      const doc = parseXml(parts[name]);
      const lines = descendants(doc.documentElement as unknown as XmlNode, 'p')
        .map(paragraphText)
        .filter((l) => l.trim().length > 0);
      return `--- Slide ${slideNumber(name)} ---\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

// "AB12" -> zero-based column index of "AB"
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function extractXlsx(data: Buffer): string {
  const parts = unzipParts(
    data,
    (n) => n === 'xl/workbook.xml' || n === 'xl/sharedStrings.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/worksheets\/[^/]+\.xml$/.test(n),
  );
  const workbookXml = parts['xl/workbook.xml'];
  if (!workbookXml) throw new UnsupportedDocumentError('Not a valid .xlsx file');

  const shared: string[] = [];
  if (parts['xl/sharedStrings.xml']) {
    const doc = parseXml(parts['xl/sharedStrings.xml']);
    for (const si of descendants(doc.documentElement as unknown as XmlNode, 'si')) {
      shared.push(descendants(si, 't').map(textOf).join(''));
    }
  }

  // sheet name -> worksheet part, via relationship ids
  const targets = new Map<string, string>();
  if (parts['xl/_rels/workbook.xml.rels']) {
    const rels = parseXml(parts['xl/_rels/workbook.xml.rels']);
    for (const rel of descendants(rels.documentElement as unknown as XmlNode, 'Relationship')) {
      const el = rel as unknown as Element;
      const target = el.getAttribute('Target') ?? '';
      targets.set(el.getAttribute('Id') ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    }
  }

  const sheets: string[] = [];
  const workbook = parseXml(workbookXml);
  for (const sheet of descendants(workbook.documentElement as unknown as XmlNode, 'sheet')) {
    const el = sheet as unknown as Element;
    const name = el.getAttribute('name') ?? 'Sheet';
    const relId = el.getAttribute('r:id') ?? '';
    const part = parts[targets.get(relId) ?? ''];
    if (!part) continue;

    const rows: string[] = [];
    const sheetDoc = parseXml(part);
    for (const row of descendants(sheetDoc.documentElement as unknown as XmlNode, 'row')) {
      const cells: string[] = [];
      for (const cell of children(row).filter((c) => c.nodeType === 1 && localName(c) === 'c')) {
        const c = cell as unknown as Element;
        const type = c.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') {
          value = descendants(cell, 't').map(textOf).join('');
        } else {
          const v = children(cell).find((x) => x.nodeType === 1 && localName(x) === 'v');
          const raw = v ? textOf(v) : '';
          if (type === 's') value = shared[parseInt(raw, 10)] ?? '';
          else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
          else value = raw;
        }
        cells[columnIndex(c.getAttribute('r') ?? 'A1')] = value.replace(/[\t\r\n]+/g, ' ');
      }
      if (cells.some((v) => v)) rows.push(Array.from(cells, (v) => v ?? '').join('\t'));
    }
    sheets.push(`--- Sheet: ${name} ---\n${rows.join('\n')}`);
  }
  return sheets.join('\n\n');
}

// pdfjs-dist 4 is ESM-only and this project compiles to CommonJS, where TypeScript would rewrite a
// plain import() into require(). Going through Function keeps it a real dynamic import.
const dynamicImport = new Function('specifier', 'return import(specifier)') as (s: string) => Promise<unknown>;

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

async function extractPdf(data: Buffer): Promise<string> {
  const pdfjs = (await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs')) as {
    getDocument: (opts: Record<string, unknown>) => {
      promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: PdfTextItem[] }>; cleanup: () => void }>;
        destroy: () => Promise<void>;
      }>;
    };
  };

  const fontsDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: fontsDir,
    isEvalSupported: false, // never evaluate font programs from untrusted files
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  try {
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
      page.cleanup();
      pages.push(`--- Page ${i} ---\n${text}`);
    }
    return pages.join('\n\n');
  } finally {
    await pdf.destroy();
  }
}

// Small LRU so that paginated reads of one document don't re-parse it on every call.
const cache = new Map<string, string>();
const CACHE_ENTRIES = 8;

export async function extractDocumentText(cacheKey: string, filePath: string, ext: string): Promise<string> {
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return cached;
  }

  const data = await fs.promises.readFile(filePath);
  let text: string;
  switch (ext) {
    case '.txt':
      text = data.toString('utf8').replace(/^﻿/, '');
      break;
    case '.pdf':
      text = await extractPdf(data);
      break;
    case '.docx':
      text = extractDocx(data);
      break;
    case '.pptx':
      text = extractPptx(data);
      break;
    case '.xlsx':
      text = extractXlsx(data);
      break;
    case '.doc':
    case '.ppt':
    case '.xls':
      throw new UnsupportedDocumentError(
        `Legacy binary ${ext} files can't be read as text. Ask the user to re-save it as ${ext}x (or PDF).`,
      );
    default:
      throw new UnsupportedDocumentError(`No text extraction for ${ext} files`);
  }

  cache.set(cacheKey, text);
  if (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value as string);
  return text;
}
