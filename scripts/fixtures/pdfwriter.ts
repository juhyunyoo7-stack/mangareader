// Minimal PDF writer for fixtures: each page is a solid colour fill plus a centred black box.
export interface PdfPageIn {
  /** page size in PDF points */
  w: number;
  h: number;
  rgb: [number, number, number];
}

/** `padBytes` adds a comment of that size after the header (a big file whose objects sit at the end). */
export function writePdf(pages: PdfPageIn[], padBytes = 0): Uint8Array {
  const objs: string[] = [];
  // 1 = catalog, 2 = pages, then per page: page object and content stream
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const [r, g, b] = p.rgb.map((c) => (c / 255).toFixed(4));
    const content =
      `${r} ${g} ${b} rg 0 0 ${p.w} ${p.h} re f\n` +
      `0 0 0 rg ${p.w * 0.4} ${p.h * 0.4} ${p.w * 0.2} ${p.h * 0.2} re f\n`;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] /Contents ${4 + i * 2} 0 R /Resources << >> >>`,
    );
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });
  let out = '%PDF-1.4\n';
  if (padBytes > 0) out += `%${'x'.repeat(padBytes)}\n`;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
