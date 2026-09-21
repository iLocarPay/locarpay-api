// Fake de pdf-lib: só o necessário para generateContractPdf (drawText/drawLine/drawImage).
export const PDFDocument = { create: async () => ({ addPage: () => ({ drawText: () => {}, drawLine: () => {}, drawImage: () => {} }), embedFont: async () => ({ widthOfTextAtSize: () => 10 }), save: async () => new Uint8Array() }) };
export const rgb = () => ({});
export const StandardFonts = { Helvetica: 'h', HelveticaBold: 'hb' };
