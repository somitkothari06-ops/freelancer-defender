// Minimal PDF writer, enough for a text-only response letter.
// PayPal only accepts evidence files as PDF/JPG/PNG/GIF, so we produce a real PDF
// without pulling in a big PDF library.

const PAGE_W = 612; // US Letter, in points
const PAGE_H = 792;
const MARGIN = 56;
const LINE_H = 14;

// Helvetica is a built-in PDF font, so it only supports basic Latin characters.
function toLatin(text) {
  return String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E§]/g, '');
}

function escapePdf(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

// Very simple word wrap: ~ 0.5em average char width for Helvetica.
function wrap(text, size, width = PAGE_W - 2 * MARGIN) {
  const maxChars = Math.floor(width / (size * 0.5));
  const out = [];
  for (const para of toLatin(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + ' ' + word).trim().length > maxChars) {
        out.push(line);
        line = word;
      } else line = (line ? line + ' ' : '') + word;
    }
    out.push(line);
  }
  return out;
}

/**
 * @param {Array<{text: string, size?: number, bold?: boolean, gap?: number}>} blocks
 * @returns {Buffer} PDF bytes
 */
function makePdf(blocks) {
  // Lay out lines onto pages.
  const pages = [[]];
  let y = PAGE_H - MARGIN;
  for (const b of blocks) {
    const size = b.size || 10;
    y -= b.gap || 0;
    for (const line of wrap(b.text, size)) {
      if (y < MARGIN) {
        pages.push([]);
        y = PAGE_H - MARGIN;
      }
      pages[pages.length - 1].push({ line, size, bold: b.bold, y });
      y -= size + 4 > LINE_H ? size + 4 : LINE_H;
    }
  }

  // Build PDF objects: 1 catalog, 2 pages, 3 font, 4 bold font, then page+content pairs.
  const objects = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, i) => {
    const stream = lines
      .map((l) => `BT /${l.bold ? 'F2' : 'F1'} ${l.size} Tf ${MARGIN} ${l.y} Td (${escapePdf(l.line)}) Tj ET`)
      .join('\n');
    const content = Buffer.from(stream, 'latin1');
    objects[pageIds[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`;
    objects[pageIds[i] + 1] = `<< /Length ${content.length} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

module.exports = { makePdf };
