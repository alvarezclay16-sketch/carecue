// Is this utterance an emergency or distress? Minimal first version (EN + ES).
// Used by the spend guard so a person in trouble is never turned away by a rate limit.
// It only decides who bypasses a cap; it never changes what the agent says.

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`´]/g, "'");

const URGENT: RegExp[] = [
  // English
  /\bchest\b.{0,20}\b(pain|hurt|hurts|tight|pressure)\b/,
  /\b(pain|pressure|tightness)\b.{0,12}\bin (my|the) chest\b/,
  /\b(can'?t|cannot|can not|unable to)\s+breathe?\b/,
  /\b(trouble|hard|difficult|difficulty)\s+(to\s+)?breath(e|ing)\b/,
  /\bshort of breath\b/,
  /\bi\s*(have\s+)?(fell|fallen|fell down)\b/,
  /\bi('ve| have)? fallen\b/,
  /\b(hurt|hurting|harm|kill)\s+myself\b/,
  /\b(want|wanna) to die\b/,
  // Spanish (accents folded)
  /\b(dolor|presion|opresion)\b.{0,15}\bpecho\b/,
  /\bme duele\b.{0,12}\bpecho\b/,
  /\bno puedo respirar\b/,
  /\bme falta (el )?(aire|aliento)\b/,
  /\bme cai\b/,
  /\bme he caido\b/,
  /\b(hacerme (dano|mal)|lastimarme|matarme|hacerle dano a mi)\b/,
  /\bquiero morir(me)?\b/,
];

export function isUrgentText(text: string): boolean {
  const t = fold(String(text ?? ""));
  if (!t) return false;
  return URGENT.some((re) => re.test(t));
}
