// Which language was this turn spoken in? Used only to pick the few fixed sentences (limit notice, fallback replies),
// never to translate or to decide anything about health. No imports on purpose.
// "me" and "mi" are not evidence either way ("Tell me what is next"), and a transcript from a speaker has no accents:
// count words that belong to one language only, and when the text does not settle it, use the household's language.

const ES_WORDS = new Set(
  ("que hola gracias ayuda pastilla pastillas remedio remedios medicina medicinas tome tomo toca hoy ahora cuando donde como " +
    "estoy tengo quiero puedo necesito favor bien muy los las del una por para con mis dolor otra dosis manana noche tarde si es se su " +
    "duele duelen siento mareo mareada mareado cai cayo pecho cabeza llama llamar hija hijo mal").split(" "),
);
const EN_WORDS = new Set(
  ("the what whats did my pill pills take took thanks thank hello hi tell is are am i im you can could next when please help now today " +
    "have had do does it this that with for and of to not dont ive again another medicine morning night").split(" "),
);

/** True when the text is Spanish, false when English; an unclear text takes the household's language. */
export function speaksSpanish(text: string, householdIsSpanish: boolean): boolean {
  const s = String(text ?? "").toLowerCase();
  let es = /[¿¡ñáéíóúü]/.test(s) ? 2 : 0;
  let en = 0;
  for (const w of s.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/)) {
    if (ES_WORDS.has(w)) es++;
    if (EN_WORDS.has(w)) en++;
  }
  if (es !== en) return es > en;
  return householdIsSpanish;
}
