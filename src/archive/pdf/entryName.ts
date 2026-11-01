/** Synthetic page entry names for PDF books (kept apart from pdfBook so importing them stays cheap). */
export const pdfEntryName = (i: number): string => `pdf-page-${String(i + 1).padStart(5, '0')}`;
export const pdfEntryIndex = (name: string): number => Number(name.slice('pdf-page-'.length)) - 1;
