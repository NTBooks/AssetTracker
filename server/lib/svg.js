import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function escapeXml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tryRenderTemplate(templateName, data) {
  try {
    // Support either .svg or .xml template filenames
    const baseDir = path.join(__dirname, '..', 'templates');
    const candidatePaths = [
      path.join(baseDir, `${templateName}.svg`),
      path.join(baseDir, `${templateName}.xml`),
    ];
    const existingPath = candidatePaths.find((p) => fs.existsSync(p));
    if (!existingPath) return null;
    let svg = fs.readFileSync(existingPath, 'utf8');
    for (const [k, v] of Object.entries(data || {})) {
      const token = new RegExp(`##${k}##`, 'gi');
      svg = svg.replace(token, escapeXml(v));
    }
    return svg;
  } catch {
    return null;
  }
}

function svgWrapper(inner, title = 'Certificate') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600">
  <defs>
    <style>
      .title{font: 700 36px sans-serif; fill:#8b4513}
      .label{font: 600 18px sans-serif; fill:#4b5563}
      .value{font: 400 20px ui-monospace, SFMono-Regular, Menlo, monospace; fill:#111827}
      .note{font: 400 14px sans-serif; fill:#374151}
      .badge{fill:#fef3c7;stroke:#92400e;stroke-width:2}
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#fff7ed"/>
  <rect x="20" y="20" width="860" height="560" rx="12" ry="12" fill="#fff" stroke="#fed7aa" stroke-width="3"/>
  <text x="50" y="70" class="title">${title}</text>
  ${inner}
</svg>`;
}

function wrapTextAt(text, max = 30) {
  if (!text) return '';
  const lines = [];
  const rawLines = String(text).split(/\r?\n/);
  for (const raw of rawLines) {
    const words = raw.split(/\s+/);
    let line = '';
    for (const w of words) {
      if (!w) continue;
      const candidate = line ? `${line} ${w}` : w;
      if (candidate.length <= max) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        // extremely long word fallback
        if (w.length > max) {
          for (let i = 0; i < w.length; i += max) {
            lines.push(w.slice(i, i + max));
          }
          line = '';
        } else {
          line = w;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

export function generatePublicCertificateSvg({ sku, serial, itemName, itemDescription, ownerName }) {
  const dateIssuedShort = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const descWrapped = wrapTextAt(itemDescription ?? '', 30);
  const rendered = tryRenderTemplate('certificate', {
    META: '',
    SKU: sku,
    SERIAL: serial,
    ITEM_NAME: itemName ?? '',
    ITEM_DESC: descWrapped,
    ITEM_DESCRIPTION: descWrapped,
    DESCRIPTION: descWrapped,
    VERIFY_URL: process.env.WORK_OS_HOST || '',
    DATE_ISSUED: dateIssuedShort,
    OWNER_NAME: ownerName ?? ''
  });
  if (rendered) return rendered;
  const inner = `
  <g transform="translate(50,110)">
    <text class="label" x="0" y="0">SKU</text>
    <text class="value" x="160" y="0">${sku}</text>
    <text class="label" x="0" y="40">Serial</text>
    <text class="value" x="160" y="40">${serial}</text>
    <text class="label" x="0" y="80">Item Name</text>
    <text class="value" x="160" y="80">${itemName ?? ''}</text>
    <text class="label" x="0" y="120">Description</text>
    <foreignObject x="160" y="95" width="680" height="200">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font:16px sans-serif;color:#111827;white-space:pre-wrap">${(itemDescription ?? '').slice(0, 800)}</div>
    </foreignObject>
    <text class="label" x="0" y="320">Owner</text>
    <text class="value" x="160" y="320">${ownerName ?? ''}</text>
    <text class="label" x="0" y="360">Issued</text>
    <text class="value" x="160" y="360">${dateIssuedShort}</text>
    <text class="label" x="0" y="400">Verify</text>
    <text class="value" x="160" y="400">${process.env.WORK_OS_HOST || ''}</text>
    <rect class="badge" x="0" y="320" width="360" height="50" rx="8"/>
    <text class="note" x="16" y="352">Public Registration Certificate</text>
  </g>`;
  return svgWrapper(inner, 'Blockchain Certificate of Registration');
}

export function generatePrivateSaleSvg({ sku, serial, ownerName, nextSecret }) {
  // Build safe META content for XML comments: comments cannot include "--"
  const metaContent = JSON.stringify({ sku, serial }).replace(/--/g, '- -');
  const dateIssuedShort = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });
  const rendered = tryRenderTemplate('private_sale', {
    // Template already wraps with <!--META:##META##--> so pass only content
    META: metaContent,
    SKU: sku,
    SERIAL: serial,
    OWNER_NAME: ownerName,
    NEXT_SECRET: nextSecret,
    VERIFY_URL: process.env.WORK_OS_HOST || '',
    DATE_ISSUED: dateIssuedShort
  });
  if (rendered) return rendered;
  const inner = `
  <g transform="translate(50,110)">
    <text class="label" x="0" y="0">SKU</text>
    <text class="value" x="160" y="0">${sku}</text>
    <text class="label" x="0" y="40">Serial</text>
    <text class="value" x="160" y="40">${serial}</text>
    <text class="label" x="0" y="80">New Owner</text>
    <text class="value" x="160" y="80">${ownerName}</text>
    <text class="label" x="0" y="130">Registration Secret For Next Transfer</text>
    <text class="value" x="160" y="130">${nextSecret}</text>
    <foreignObject x="0" y="180" width="820" height="240">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font:16px sans-serif;color:#111827;white-space:pre-wrap">
        Keep this SVG private. To register ownership, visit the Verify page and use SKU/Serial, then the Register Asset form with the Registration Secret above. After registering, you will receive a new private sale document for the next transfer.
      </div>
    </foreignObject>
    <text class="label" x="0" y="460">Issued</text>
    <text class="value" x="160" y="460">${dateIssuedShort}</text>
    <text class="label" x="0" y="500">Register</text>
    <text class="value" x="160" y="500">${process.env.WORK_OS_HOST || ''}</text>
  </g>`;
  const metaComment = `<!--META:${metaContent}-->`;
  return metaComment + svgWrapper(inner, 'Private Sale Document');
}

export function generateNextSecretSvg({ sku, serial, nextSecret }) {
  const rendered = tryRenderTemplate('next_secret', {
    META: '',
    SKU: sku,
    SERIAL: serial,
    NEXT_SECRET: nextSecret
  });
  if (rendered) return rendered;
  const inner = `
  <g transform="translate(50,110)">
    <text class="label" x="0" y="0">SKU</text>
    <text class="value" x="160" y="0">${sku}</text>
    <text class="label" x="0" y="40">Serial</text>
    <text class="value" x="160" y="40">${serial}</text>
    <text class="label" x="0" y="90">Next Secret Phrase</text>
    <text class="value" x="160" y="90">${nextSecret}</text>
  </g>`;
  return svgWrapper(inner, 'Next Secret Phrase');
}

export function extractMetaFromSvg(svgString) {
  const match = svgString.match(/<!--META:(.*?)-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}


