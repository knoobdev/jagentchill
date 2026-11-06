/**
 * The two things the local picture model never makes, whatever variant runs it (owner, 2026-10-19: no gate and no
 * confirmation — everything else is allowed for the adults who use JAgentChill): sexual content involving minors,
 * and sexual content of identifiable real people. A request is refused silently — its job fails with a plain reason,
 * nothing is asked. The check reads the words of the request (English, Vietnamese, Japanese), with and without accents.
 */
const SEXUAL = [
  "nude", "nudes", "naked", "nudity", "topless", "bottomless", "sex", "sexual", "sexy", "porn", "porno", "pornographic", "nsfw", "erotic", "erotica", "explicit", "lewd", "hentai",
  "lingerie", "undress", "undressed", "undressing", "stripping", "striptease", "genitals", "genital", "penis", "vagina", "breasts", "boobs", "nipples", "intercourse", "orgasm", "fetish",
  "bdsm", "seductive", "sensual", "aroused", "masturbat*", "blowjob", "cum", "xxx", "onlyfans",
  "khoa than", "khỏa thân", "tình dục", "tinh duc", "gợi dục", "goi duc", "khiêu dâm", "khieu dam",
  "裸", "ヌード", "エロ", "性的", "セックス", "猥褻", "わいせつ", "官能", "アダルト",
];
const MINOR = [
  "child", "children", "kid", "kids", "minor", "minors", "underage", "under-age", "teen", "teens", "teenage", "teenager", "preteen", "pre-teen", "tween", "schoolgirl", "schoolboy",
  "school girl", "school boy", "loli", "lolita", "shota", "toddler", "baby", "infant", "little girl", "little boy", "young girl", "young boy", "juvenile", "pubescent", "prepubescent", "jailbait",
  "elementary school", "middle school", "junior high", "high schooler", "student uniform",
  "trẻ em", "tre em", "bé gái", "be gai", "bé trai", "be trai", "trẻ vị thành niên", "vị thành niên", "vi thanh nien", "học sinh", "hoc sinh", "em bé", "em be",
  "子供", "子ども", "こども", "児童", "少女", "少年", "幼女", "幼児", "未成年", "小学生", "中学生", "女子高生", "ロリ", "ショタ", "JK",
];
/** Words that say the picture is of a real, identifiable person. */
const REAL_PERSON = [
  "celebrity", "celebrities", "famous", "real person", "real people", "real woman", "real man", "deepfake", "deep fake", "face swap", "faceswap", "lookalike", "look-alike",
  "actress", "actor", "singer", "politician", "president", "prime minister", "influencer", "youtuber", "streamer", "athlete", "footballer", "k-pop", "kpop", "idol", "news anchor",
  "my ex", "my girlfriend", "my boyfriend", "my wife", "my husband", "my coworker", "my co-worker", "my colleague", "my classmate", "my neighbor", "my neighbour", "my boss", "my teacher", "my friend", "my sister", "my cousin",
  "người nổi tiếng", "nguoi noi tieng", "ca sĩ", "ca si", "diễn viên", "dien vien", "người thật", "nguoi that",
  "有名人", "芸能人", "女優", "俳優", "歌手", "アイドル", "実在", "政治家",
];
const fold = (text: string) => text.toLowerCase().normalize("NFKC");
const strip = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
/** A word list matched as whole words for Latin words (a word ending in `*` as a beginning), anywhere for words in scripts without spaces. */
function finds(text: string, words: readonly string[]): string | undefined {
  const plain = strip(text);
  for (const entry of words) {
    const prefix = entry.endsWith("*"), word = prefix ? entry.slice(0, -1) : entry;
    const latin = /^[\p{Script=Latin}\d\s'-]+$/u.test(word);
    if (!latin) { if (text.includes(word)) return word; continue; }
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${strip(fold(word)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${prefix ? "" : "($|[^\\p{L}\\p{N}])"}`, "u");
    if (pattern.test(plain)) return word;
  }
  return undefined;
}
/** An age under 18 said in digits ("16 years old", "15yo", "aged 12", "16 tuổi", "15歳"). */
const UNDER_AGE = /(^|[^\d])(1[0-7]|[1-9])\s*(-?\s*(years?|yrs?)\s*-?\s*old|yo\b|y\/o|tuoi|tuổi|歳|才)|aged\s+(1[0-7]|[1-9])\b/u;

export type HardLimit = { rule: "minor" | "real_person"; message: string };
/**
 * The hard limit a request crosses, or undefined. `prompt` and `negativePrompt` are read together with the name of a
 * reference picture's subject when there is one; a request with reference pictures that asks for sexual content is
 * treated as of a real person (the picture is of somebody).
 */
export function hardLimitOf(request: { prompt?: string; references?: number }): HardLimit | undefined {
  const text = fold(request.prompt ?? "");
  if (!text.trim()) return undefined;
  const sexual = finds(text, SEXUAL);
  if (!sexual) return undefined;
  if (finds(text, MINOR) || UNDER_AGE.test(strip(text))) return { rule: "minor", message: "This picture cannot be made: sexual content involving minors is never generated." };
  if (finds(text, REAL_PERSON) || (request.references ?? 0) > 0) return { rule: "real_person", message: "This picture cannot be made: sexual content of real, identifiable people is never generated." };
  return undefined;
}
