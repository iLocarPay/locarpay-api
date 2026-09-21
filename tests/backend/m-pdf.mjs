export const PDFDocument = { create: async () => ({ addPage: () => ({ drawText: () => {}, drawImage: () => {} }), embedFont: async () => ({ widthOfTextAtSize: () => 10 }), save: async () => new Uint8Array() }) };
export const rgb = () => ({});
export const StandardFonts = { Helvetica: 'h', HelveticaBold: 'hb' };
