// Text folding shared by care.ts and the lexicons. No imports on purpose: importing this opens no database.

/** Lowercase, no accents, no punctuation: "Losartán " -> "losartan". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}
