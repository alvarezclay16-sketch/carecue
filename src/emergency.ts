// What did the person just say? Small EN + ES lexicons applied to folded text (no accents, no punctuation).
// Used only for UI scenes, the rate-limit bypass (a person in trouble is never turned away) and the optional
// safety net. They never rewrite or replace what the model says.
// Folded text has no apostrophes: "can't" -> "cant", "I'm" -> "im".

import { fold } from "./fold.ts";

const norm = (text: unknown) => fold(String(text ?? "").replace(/[-_/]+/g, " ")).replace(/\s+/g, " ");

const any = (list: RegExp[], t: string) => list.some((re) => re.test(t));

// ---------- medical emergency ----------

const MEDICAL: RegExp[] = [
  // English: chest pain or pressure
  /\bchest (pain|pains|pressure|tightness|discomfort)\b/,
  /\bmy chest\b.{0,25}\b(pain|pains|hurt|hurts|hurting|tight|tightness|pressure|heavy|squeezing|burning|aches)\b/,
  /\b(pain|pains|pressure|tightness|ache|discomfort)\b.{0,15}\b(in|on|across) (my|the) chest\b/,
  /\b(having|think im having|think i am having|might be having) a heart attack\b/,
  // can't breathe
  /\b(cant|cannot|can not|couldnt|could not|unable to|wont)\s+(\w+\s+)?breathe?\b/,
  /\b(cant|cannot|can not|couldnt) catch my breath\b/,
  /\b(trouble|hard|difficult|difficulty|struggling|struggle)\s+(to\s+|with\s+)?breath(e|ing)\b/,
  /\b(short of breath|shortness of breath|gasping)\b/,
  // a fall ("fell asleep" is not one)
  /\bi\s+(just |have |had |ve |really |think i |think i just )?(fell|fallen)\b(?! (asleep|in love|behind|apart|short|for|out of|off the wagon))/,
  /\bive (just )?fallen\b/,
  /\b(slipped|tripped) and (fell|hit)\b/,
  /\bi (had|took) a (bad )?(fall|tumble)\b/,
  /\bcant (get|stand) up\b/,
  /\bon the (floor|ground)\b.{0,25}\b(cant|unable|help)\b/,
  // fainting
  /\b(fainted|fainting|passed out|blacked out|blackout|lost consciousness|about to faint|going to faint|feel faint|feeling faint|almost fainted|almost passed out)\b/,
  // confusion
  /\bconfused\b(?! (about|by|with|between|over|which|on)\b)/,
  /\b(dont|do not) know where i am\b/,
  /\bcant remember (where i am|who i am|my name)\b/,
  // stroke signs
  /\bface\b.{0,20}\b(droop\w*|numb|crooked|sagging|lopsided|fallen)\b/,
  /\b(droop\w*|crooked|sagging)\b.{0,15}\b(face|smile|mouth)\b/,
  /\bslurr(ed|ing)\b/,
  /\b(speech|speaking|talking|words|tongue)\b.{0,25}\b(slurred|slurring|wrong|funny|strange|odd|off|mixed up|garbled)\b/,
  /\b(trouble|difficulty|cant|cannot|unable to) (speak|speaking|talk|talking|find (the |my )?words)\b/,
  /\b(weak|weakness|numb|numbness|tingling|paralyzed|paralysed|cant move|dead)\b.{0,25}\b(one side|left side|right side|left arm|right arm|left leg|right leg|my arm|my leg|half of my body)\b/,
  /\b(one side|left side|right side|my left arm|my right arm|my left leg|my right leg|my arm|my leg)\b.{0,25}\b(weak|weakness|numb|numbness|tingling|paralyzed|paralysed|cant move|dead)\b/,
  /\b(wont|will not|doesnt|does not) stop bleeding\b/,
  /\b(call|need|get|send)\b.{0,12}\b(an ambulance|ambulance|paramedics|911|131|emergency room)\b/,

  // Spanish
  /\b(dolor|presion|opresion|molestia|punzada|apretazon|ardor)\b.{0,20}\b(en |del |de )?(el |mi )?pecho\b/,
  /\bpecho\b.{0,20}\b(duele|dolor|aprieta|apretado|oprime|oprimido|pesa|pesado|arde)\b/,
  /\bme duele\b.{0,15}\bpecho\b/,
  /\bno (puedo|logro|consigo|alcanzo)\s+(\w+\s+)?(respirar|tomar aire)\b/,
  /\bme (falta|cuesta|ahogo|estoy ahogando)\b.{0,12}\b(aire|aliento|respirar)\b/,
  /\bme ahogo\b/,
  /\b(dificultad|problemas?|cuesta|falta de)\b.{0,8}\b(respirar|aire)\b/,
  /\bme (cai|he caido|caigo|estoy cayendo|resbale|tropece)\b(?! de (sueno|risa|cansancio))/,
  /\b(cai|caido|caida|tirada|tirado)\b.{0,15}\b(al )?(suelo|piso)\b/,
  /\btirad[oa] en el (suelo|piso)\b/,
  /\bno (me (puedo|logro) levantar|(puedo|logro) levantarme)\b/,
  /\bdesmay\w*\b/,
  /\b(perdi el conocimiento|me desvaneci|casi me desmayo|me voy a desmayar)\b/,
  /\b(estoy|me siento|ando|toda|muy|bien|algo|tan)\b.{0,12}\bconfundid[oa]\b(?! (con|por|entre|de cual|sobre)\b)/,
  /\bno se donde estoy\b/,
  /\bcara\b.{0,20}\b(caida|torcida|desviada|dormida|chueca|adormecida)\b/,
  /\b(boca|rostro|labio)\b.{0,15}\b(torcid\w+|caid\w+|desviad\w+)\b/,
  /\b(hablo|hablando|habla|pronuncio|lengua)\b.{0,15}\b(raro|rara|enredad[oa]|traba\w*|mal|torpe)\b/,
  /\bno (puedo|logro|consigo) hablar\b/,
  /\bse me traba\w* la lengua\b/,
  /\b(palabras)\b.{0,15}\b(raras|enredadas|no me salen|salen mal)\b/,
  /\b(un lado|lado (izquierdo|derecho))\b.{0,30}\b(debil|dormid[oa]|adormecid[oa]|paralizad[oa]|entumecid[oa]|no (lo )?(puedo )?(mover|siento))\b/,
  /\b(debil|dormid[oa]|adormecid[oa]|paralizad[oa]|entumecid[oa])\b.{0,30}\b(un lado|lado (izquierdo|derecho))\b/,
  /\b(brazo|pierna)\b.{0,15}\b(dormid[oa]|adormecid[oa]|debil|paralizad[oa]|entumecid[oa])\b/,
  /\bno (puedo|logro) mover (el|la|mi) (brazo|pierna|mano)\b/,
  /\b(llamar|llamen|llama|necesito|pidan|pedir)\b.{0,12}\b(una |la )?(ambulancia|131)\b/,
  /\bno para de sangrar\b/,
];

// ---------- distress (hopeless, self-harm) ----------

const DISTRESS: RegExp[] = [
  // English
  /\bburden\b/,
  /\b(hurt|hurting|harm|harming|kill|killing|end)\s+(my ?self|my life|it all)\b/,
  /\bsuicid\w*/,
  /\b(want|wanna|wish|going|like) to (die|disappear|be dead|end it)\b/,
  /\bbetter off (dead|without me)\b/,
  /\b(dont|do not|no longer|not going to) (want|wanna) to (live|be here|go on|be alive|wake up)\b/,
  /\b(dont|do not|no longer|wont|not going to) (need|want) (them|these|those|it|my pills|my medicine|my medicines|my medication|my meds|the pills|the medicine|any of (them|it)|anything)\b.{0,10}\b(anymore|any more|any longer)\b/,
  /\bnothing (really |even )?(matters|is worth it)\b/,
  /\b(no|whats the) (point|reason)\b.{0,15}\b(living|going on|anything|continuing|to live|of it all|in living)\b/,
  /\b(life|living) (is not|isnt) worth\b/,
  /\bnobody would (care|miss me|notice)\b/,
  /\btake all (of )?(my|the) (pills|medicine|medication|meds)\b/,
  /\b(overdose|overdosing)\b/,
  // Spanish
  /\b(soy|ser|siendo|siento|sentirme|me siento|resulto|resultar|sere)\b.{0,15}\bcarga\b/,
  /\buna carga para\b/,
  /\bcarga para (todos|mi|la|mis|ustedes|mi familia)\b/,
  /\bhacerme (dano|mal)\b/,
  /\b(lastimarme|herirme|matarme|quitarme la vida|suicidarme|suicidio|cortarme las venas)\b/,
  /\bacabar con (mi vida|todo)\b/,
  /\bno quiero (seguir )?(vivir|estar aqui|estar viva|estar vivo|despertar|seguir viviendo)\b/,
  /\bya no quiero seguir\b/,
  /\bquiero (morir|morirme|desaparecer|dejar de existir)\b/,
  /\bmejor (estarian|estaria|estar) (sin mi|muert[oa])\b/,
  /\bestar(ian|ia) mejor sin mi\b/,
  /\bnada (me )?importa\b/,
  /\bno (tiene|hay) (sentido|razon)\b.{0,15}\b(vivir|seguir|nada)\b/,
  /\bpara que (sigo|seguir|vivir)\b/,
  /\bya no (las|los) (necesito|quiero)\b/,
  /\b(no|ya no) (necesito|quiero) (mas )?(mis |las |los )?(pastillas|remedios|medicamentos|medicinas)\b/,
];

// ---------- wants an extra, double or half dose ----------

const TAKE = "(took|take|taking|taken|had|have|swallowed|swallow|tomo|tome|tomar|tomarme|tomado|tomarla|tomarlo|me tome|me tomo)";

const EXTRA_DOSE: RegExp[] = [
  // English
  /\b(another|an other|a second|an additional)\s+(one|pill|tablet|dose|capsule|pills|tablets|doses)\b/,
  /\btake (some |a few )?more\b/,
  /\bone more\b(?! (thing|time|question|day|minute|moment|hour|word))/,
  /\bextra\s+(dose|doses|pill|pills|tablet|tablets|one|capsule|medicine|medication|meds|just)\b/,
  /\b(take|took|taking|swallow|swallowed)\b.{0,20}\bextra\b/,
  /\bdoubl(e|ing)\s+(dose|up|the|my|it|pill|pills|tablet|tablets|that)\b/,
  /\b(a )?double dose\b/,
  /\b(took|take|taking|taken|swallowed|had)\b.{0,25}\btwice\b(?! (a|per|each|every) (day|week|morning|night|evening|afternoon))/,
  /\btwice\b.{0,20}\b(pill|pills|dose|tablet|medicine|losartan|metformin)\b/,
  /\b(take|took|taking|swallow|another|more|extra|one)\b.{0,25}\bjust in case\b/,
  /\bjust in case\b.{0,20}\b(take|pill|dose|tablet)\b/,
  /\bhalf (a |of a |of the |the )?(dose|pill|tablet)\b/,
  /\b(took|take|taking|taken|had|have|swallowed|swallow)\b.{0,25}\bagain\b/,
  // Spanish
  /\botra (mas|pastilla|dosis|tableta|pildora|capsula)\b/,
  /\botra mas\b/,
  /\buna mas\b/,
  /\buno mas\b/,
  /\b(tomar|tomo|tome|tomarme|otra|pastilla|dosis|mas)\b.{0,25}\bpor si (acaso|las dudas)\b/,
  /\bpor si (acaso|las dudas)\b.{0,20}\b(tomar|tomo|pastilla|dosis|otra)\b/,
  /\bdoble (dosis|pastilla|cantidad|de pastillas)\b/,
  /\b(tomar|tomo|tome|tomarme|dos|tomaria)\b.{0,15}\bdoble\b/,
  /\b(media|la mitad de una?) (pastilla|dosis)\b/,
  /\b(tomar|tomo|tome|tomarme|tomado|tomaba)\b.{0,25}\bdos veces\b(?! (al|por|a la|cada|en el) (dia|semana|manana|noche|tarde))/,
  /\bdos veces\b.{0,15}\b(pastilla|pastillas|dosis)\b/,
  /\b(tomar|tomo|tome|tomarme|tomarla|tomarlo|tomado|me tome|me tomo|tomaba)\b.{0,25}\b(otra vez|de nuevo|nuevamente)\b/,
  /\b(tomar|tomo|tome|tomarme|tomarla|tomarlo|puedo tomar|quiero tomar|me tomo|me tome)\b.{0,20}\b(otra(?! (taza|vaso|copa|cosa|cerveza|cafe|te)\b)|mas pastillas|de mas|extra)\b/,
  /\b(pastillas?|dosis|remedios?)\b.{0,10}\b(extra|de mas)\b/,
];

/** Chest pain, can't breathe, a fall, fainting, confusion, face drooping, slurred speech, weakness on one side. */
export function isMedicalEmergency(text: string): boolean {
  const t = norm(text);
  return !!t && any(MEDICAL, t);
}

/** Hopeless or self-harm talk: "I'm a burden", "nothing matters", "no quiero vivir". */
export function isDistress(text: string): boolean {
  const t = norm(text);
  return !!t && any(DISTRESS, t);
}

// "another Losartan", "otra Metformina": after another/otra a medicine of the household, one of these common names, or a generic word.
const COMMON_MEDS = ["metformin", "losartan", "atorvastatin", "amlodipine", "lisinopril", "simvastatin", "omeprazole", "levothyroxine", "aspirin", "warfarin", "insulin", "paracetamol", "ibuprofen"];
const GENERIC_MED = "(medicine|medicines|medication|medications|med|meds|medicina|medicinas|medicamento|medicamentos|remedio|remedios|pildora|pildoras|comprimido|comprimidos|capsulas?|tabletas?|pastillas?)";
const compact = (m: string) => m.replace(/[^a-z0-9]/g, "");
/**
 * How a medicine is recognised after "another/otra". A name of 6 or more letters matches by its first 6 letters with a
 * short ending ("metformina" for Metformin, "losartan" for Losartán), always ending at a word boundary. A name shorter
 * than 6 letters must be there in full, with at most a plural s/es ("iron", "irons"), so "pillow" never matches "Pill".
 */
const namePattern = (m: string): string | null => {
  const full = compact(m);
  if (full.length < 4) return null;
  return full.length < 6 ? `${full}(?:s|es)?\\b` : `${full.slice(0, 6)}\\w{0,${full.length - 6 + 3}}\\b`;
};

/** Wants another, double or half dose, or says they took a pill again. `medNames`: the household's medicines. */
export function isExtraDoseIntent(text: string, medNames: string[] = []): boolean {
  const t = norm(text);
  if (!t) return false;
  // Names match like the rest of the app (first 6 letters for long names), but always up to a word boundary; see namePattern.
  const names = [...new Set([...COMMON_MEDS, ...medNames.map((m) => norm(m))].map(namePattern).filter((s): s is string => !!s))];
  if (names.length && new RegExp(`\\b(another|an other|otra|otro|one more|una mas|uno mas)\\s+(of\\s+|de\\s+)?(my\\s+|the\\s+|mi\\s+|la\\s+|el\\s+)?(${names.join("|")})`).test(t)) return true;
  if (new RegExp(`\\b(another|an other|otra|otro)\\s+(of\\s+|de\\s+)?(my\\s+|the\\s+|mi\\s+|la\\s+|el\\s+)?${GENERIC_MED}\\b`).test(t)) return true;
  // "when do I take it again?" is a schedule question, not an extra dose.
  if (/\b(when|what time|how often|how long|until|cuando|a que hora)\b.{0,40}\b(again|otra vez|de nuevo)\b/.test(t) && !/\b(another|more|extra|otra (mas|pastilla|dosis)|doble)\b/.test(t))
    return false;
  return any(EXTRA_DOSE, t);
}

/** Anyone who must never be turned away by a rate limit: a medical emergency or distress. */
export function isUrgentText(text: string): boolean {
  return isMedicalEmergency(text) || isDistress(text);
}
