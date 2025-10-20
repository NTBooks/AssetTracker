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
    const templatePath = path.join(__dirname, '..', 'templates', `${templateName}.svg`);
    if (!fs.existsSync(templatePath)) return null;
    let svg = fs.readFileSync(templatePath, 'utf8');
    for (const [k, v] of Object.entries(data || {})) {
      const token = new RegExp(`##${k}##`, 'g');
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

export function generatePublicCertificateSvg({ sku, serial, itemName, itemDescription }) {
  const rendered = tryRenderTemplate('certificate', {
    META: '',
    SKU: sku,
    SERIAL: serial,
    ITEM_NAME: itemName ?? '',
    ITEM_DESC: itemDescription ?? ''
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
    <rect class="badge" x="0" y="320" width="360" height="50" rx="8"/>
    <text class="note" x="16" y="352">Public Registration Certificate</text>
  </g>`;
  return svgWrapper(inner, 'Blockchain Certificate of Registration');
}

export function generatePrivateSaleSvg({ sku, serial, ownerName, nextSecret }) {
  const meta = `<!--META:${JSON.stringify({ sku, serial })}-->`;
  const rendered = tryRenderTemplate('private_sale', {
    META: meta,
    SKU: sku,
    SERIAL: serial,
    OWNER_NAME: ownerName,
    NEXT_SECRET: nextSecret
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
    <text class="label" x="0" y="130">Unlock Secret For Next Transfer</text>
    <text class="value" x="160" y="130">${nextSecret}</text>
    <foreignObject x="0" y="180" width="820" height="280">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font:16px sans-serif;color:#111827;white-space:pre-wrap">
        Keep this SVG private. To register ownership, visit the Verify page and use SKU/Serial, then the Register Asset form with the Unlock Secret above. After registering, you will receive a new private sale document for the next transfer.
      </div>
    </foreignObject>
  </g>`;
  return meta + svgWrapper(inner, 'Private Sale Document');
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


