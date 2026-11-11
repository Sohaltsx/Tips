// Message & name moderation for on-stream alerts.
// Runtime-agnostic (Deno + Node ≥ 23) so it can be unit-tested locally.

export const MAX_MESSAGE_LENGTH = 200;
export const MAX_NAME_LENGTH = 30;
const MAX_EMOJI = 5;

/**
 * Blocklists — edit freely. Matching uses a normalised form of each word
 * (lower-case, leetspeak undone, separators removed, repeated letters
 * collapsed), so "F*U*U*C*K", "fuuuck", "fvck" and "f.u.c.k" all match "fuck".
 *
 * BLOCK_ANYWHERE: matched inside any word ("motherfucker" hits "fuck").
 *   Only put roots here that never occur inside normal words.
 * BLOCK_WORDS: matched only as a whole word (so "peacock", "chutney",
 *   "Gandhi", "Scunthorpe" stay clean).
 */
export const BLOCK_ANYWHERE: string[] = [
  // English
  "fuck", "shit", "bitch", "asshole", "nigger", "nigga", "faggot", "whore", "pussy",
  // Hindi / Hinglish (Latin script)
  "madarchod", "maderchod", "behenchod", "bhenchod", "benchod", "bhanchod",
  "chutiya", "chutia", "chutiye", "bhosd", "lauda", "lawda", "lavda", "lavde",
  "lawde", "haramkhor", "randi", "gandu", "chodu",
  // Hindi (Devanagari)
  "मादरचोद", "बहनचोद", "भेनचोद", "चूतिया", "चुतिया", "गांडू", "गाँडू", "भोसड",
  "लौड़ा", "लौडा", "रंडी", "हरामखोर", "चोद",
];

export const BLOCK_WORDS: string[] = [
  // English
  "fuk", "fck", "fk", "dick", "cunt", "cock", "slut", "bastard", "retard", "stfu", "kys",
  // Hindi / Hinglish (Latin script)
  "chut", "gand", "gaand", "bsdk", "loda", "lode", "lund", "raand", "harami",
  "kamina", "kamine", "jhatu", "jhaat", "chod", "mc", "bc", "mkc", "bkl",
  "suar", "kutta", "kutte", "kutti", "kuttiya",
  // Hindi (Devanagari)
  "गांड", "लंड", "हरामी", "कमीना", "कमीने", "झाटू", "कुत्ता", "कुत्ते", "कुतिया",
];

const LEET: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "@": "a", "$": "s", "!": "i", "|": "i", "+": "t",
};

/** Lower-case, undo leetspeak, drop separators, collapse letter runs ("fuuuck" → "fuck"). */
export function normalizeWord(word: string): string {
  let w = word.toLowerCase().normalize("NFKC");
  w = [...w].map((c) => LEET[c] ?? c).join("");
  w = w.replace(/[^\p{L}\p{M}\p{N}]/gu, ""); // remove * . _ - etc. inside the word
  w = w.replace(/v/g, "u"); // fvck → fuck (cheap, effective)
  w = w.replace(/(.)\1+/gu, "$1");
  return w;
}

const anywhere = BLOCK_ANYWHERE.map(normalizeWord).filter(Boolean);
const wholeWords = new Set(BLOCK_WORDS.map(normalizeWord).filter(Boolean));

export function isAbusiveWord(word: string): boolean {
  const n = normalizeWord(word);
  if (!n) return false;
  if (wholeWords.has(n)) return true;
  // simple plurals: "dicks", "kuttas"
  if (n.length > 2 && n.endsWith("s") && wholeWords.has(n.slice(0, -1))) return true;
  return anywhere.some((b) => n.includes(b));
}

export function containsAbuse(text: string): boolean {
  return text.split(/\s+/).some(isAbusiveWord);
}

function mask(word: string): string {
  const chars = [...word];
  return chars.length <= 1 ? "*" : chars[0] + "*".repeat(chars.length - 1);
}

const URL_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|in|net|org|gg|io|xyz|me|tv|ly|co|app|link|site|shop|online|live|info|biz|ru|tk)\b(?:\/\S*)?/giu;
const MENTION_RE = /(^|\s)@[\p{L}\p{N}_.]+/gu;
const HTML_RE = /<[^>]*>/g;
const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g;

/** Clean free text: strip HTML/control chars/URLs/mentions, limit spam, collapse whitespace. */
export function cleanText(input: string, maxLength: number): string {
  let s = String(input ?? "");
  s = s.replace(HTML_RE, " ");
  s = s.replace(CONTROL_RE, "");
  s = s.replace(URL_RE, " ");
  s = s.replace(MENTION_RE, "$1");
  // Repeated characters: "heyyyyyyy" → "heyyy", "!!!!!!" → "!!!"
  s = s.replace(/(.)\1{3,}/gu, "$1$1$1");
  // Excessive emoji: keep the first MAX_EMOJI
  let emojiCount = 0;
  s = s.replace(EMOJI_RE, (m) => (++emojiCount <= MAX_EMOJI ? m : ""));
  s = s.replace(/\s+/g, " ").trim();
  return [...s].slice(0, maxLength).join("").trim();
}

/** Full message moderation: clean + mask abusive words. */
export function filterMessage(input: string | null | undefined): string {
  const cleaned = cleanText(input ?? "", MAX_MESSAGE_LENGTH);
  return cleaned
    .split(" ")
    .map((w) => (isAbusiveWord(w) ? mask(w) : w))
    .join(" ");
}

/** Name moderation: clean; abusive or empty → "Anonymous". */
export function filterName(input: string | null | undefined): string {
  const cleaned = cleanText(input ?? "", MAX_NAME_LENGTH);
  if (!cleaned || containsAbuse(cleaned)) return "Anonymous";
  return cleaned;
}
