/**
 * With the composer's "make pictures on this computer" switch on, the chat is for pictures: every message is a picture
 * (or a change of the last one) made by the person's model from their own words — except a message that is plainly
 * about something else, which goes to the agent: a video or movement, an edit of the timeline, a question about how a
 * picture is going, a short acknowledgement, a slash command. Words in Vietnamese (with and without accents), English
 * and Japanese.
 */
const strip = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const word = (words: string) => new RegExp(`(?:^|[^a-z])(?:${words})(?![a-z])`);

/** A video, a clip or movement: making a video is not making a picture. */
const MOTION = word("video|clip|movie|film|animation|animate|animated|chuyen dong|cu dong|nhay mua|motion|moving|gif|reel|tiktok");
const MOTION_JA = /動画|アニメ|ムービー/;
/** "phim" (a film) is read with its accents: without them it is also "phím" (a key — "gõ phím", typing). */
const FILM = /(?:^|[^\p{L}])phim(?![\p{L}])/u;
/** An edit of the timeline or the project. */
const EDITOR = word("timeline|dong thoi gian|cat|trim|tach|split|keo dai|rut ngan|dat len|dua len|dua vao|di chuyen|move|place|chu|text|tieu de|title|phu de|caption|subtitle|nhac|music|am thanh|audio|sound|giong doc|voiceover|xuat|export|chuyen canh|transition|hieu ung|effect|filter|bo loc|toc do|speed|am luong|volume|accept|chap nhan|revert|hoan tac|undo");
/** Taking something away: an edit, unless the same message asks for the picture again. */
const REMOVE = word("xoa|delete|remove|bo di|go bo");
/** Asking for the picture again or changed. */
const AGAIN = word("lam lai|tao lai|ve lai|gen lai|redo|again|another|hon|more|less|sexy|goi cam|them|doi|thay|sua|change|edit");
/** A question about the work going on, or a stop. */
const STATUS = word("toi dau roi|den dau roi|xong chua|bao lau|con lau|tien do|progress|how long|is it done|status|dung lai|stop|cancel|huy");
/** About the tools themselves, not a picture. */
const META = word("tool|imagegen|cong cu|model|agent|setting|cai dat");
const ACK = /^(?:ok|oke|okay|uh|u|vang|da|duoc|nhe|cam on|thanks|thank you|tot|hay|good|great|yes|no|khong|co|roi)(?:\s+(?:nhe|nha|roi|a|nhe ban))?[\s.!?]*$/;
const JAPANESE_PICTURE = /画像|写真|イラスト|絵/;

export function isPictureRequest(text: string): boolean {
  const raw = text.trim(), said = strip(raw);
  if (!said || said.startsWith("/")) return false;
  if (MOTION.test(said) || MOTION_JA.test(raw) || FILM.test(raw.toLowerCase().normalize("NFC"))) return false;
  if (JAPANESE_PICTURE.test(raw)) return true;
  if (ACK.test(said) || (said.split(/\s+/).length < 3 && !AGAIN.test(said))) return false;
  if (STATUS.test(said) || META.test(said)) return false;
  // A long or quoted description is a picture even when it names a word of the editor ("a desk with a laptop").
  if (raw.length > 220 || /["“”「」『』]/.test(raw)) return true;
  if (REMOVE.test(said)) return AGAIN.test(said);
  return !EDITOR.test(said);
}

/** A message that writes out a whole picture (a quoted prompt, or a long description) rather than changing the last one. */
export function isWholePrompt(text: string): boolean {
  return /["“”「」『』]/.test(text) || text.trim().length > 220;
}
