/**
 * Science Bowl Round Parser
 * Handles PDF and DOCX extracted text and converts to structured questions
 */

export function parseRoundText(rawText) {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const questions = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Detect tossup/bonus start
    const tossupMatch = line.match(/^(\d+)\s*[-.]?\s*TOSSUP/i);
    const bonusMatch = line.match(/^(\d+)\s*[-.]?\s*BONUS/i);

    if (tossupMatch || bonusMatch) {
      const qNum = parseInt((tossupMatch || bonusMatch)[1]);
      const qType = tossupMatch ? 'TOSSUP' : 'BONUS';

      // Next line usually has subject + format
      const metaLine = lines[i + 1] || '';
      const { subject, format } = parseSubjectFormat(metaLine);

      // Collect question lines
      let questionLines = [];
      let choices = {};
      let answerText = '';
      let j = i + 2;

      // skip meta line if it was consumed
      // Some parsers include meta on same line
      const metaOnSameLine = /\b(Multiple Choice|Short Answer)\b/i.test(line);
      const metaOnNext = /\b(Multiple Choice|Short Answer)\b/i.test(metaLine);

      let startIdx = metaOnNext ? i + 2 : i + 1;
      j = startIdx;

      while (j < lines.length) {
        const l = lines[j];

        // Stop if we hit the next question
        if (/^(\d+)\s*[-.]?\s*(TOSSUP|BONUS)/i.test(l)) break;

        // Detect MC choices W/X/Y/Z
        const choiceMatch = l.match(/^([WXYZ])\s*[).:\-]\s*(.+)/i);
        if (choiceMatch) {
          choices[choiceMatch[1].toUpperCase()] = choiceMatch[2].trim();
          j++;
          continue;
        }

        // Detect answer line
        const answerMatch = l.match(/^ANSWER\s*[:.]?\s*(.+)/i);
        if (answerMatch) {
          answerText = answerMatch[1].trim();
          j++;
          break;
        }

        questionLines.push(l);
        j++;
      }

      const questionText = questionLines.join(' ').trim();
      const { clean: cleanAnswer, alternates } = parseAnswer(answerText);

      if (questionText) {
        questions.push({
          number: qNum,
          type: qType,
          subject: subject || guessSubject(questionText),
          format: format || (Object.keys(choices).length > 0 ? 'Multiple Choice' : 'Short Answer'),
          question_text: questionText,
          choices: Object.keys(choices).length > 0 ? choices : null,
          answer: cleanAnswer,
          answer_alternates: alternates,
        });
      }

      i = j;
    } else {
      i++;
    }
  }

  return questions;
}

function parseSubjectFormat(line) {
  let subject = '';
  let format = '';

  if (/multiple choice/i.test(line)) format = 'Multiple Choice';
  else if (/short answer/i.test(line)) format = 'Short Answer';

  // Extract subject: strip the format keyword and trim whatever remains
  const stripped = line
    .replace(/multiple choice/i, '')
    .replace(/short answer/i, '')
    .replace(/[,;|–\-]/g, ' ')
    .trim();

  // Try known subjects first for canonical naming
  const knownSubjects = ['Biology', 'Chemistry', 'Physics', 'Earth and Space', 'Earth Science', 'Math', 'Mathematics', 'Energy', 'General Science', 'Astronomy', 'Computer Science'];
  for (const kw of knownSubjects) {
    if (stripped.toLowerCase().includes(kw.toLowerCase())) {
      // Preserve canonical casing
      subject = kw === 'Mathematics' ? 'Math' : kw;
      break;
    }
  }

  // If no known subject, use whatever non-empty text is left (preserves custom subjects)
  if (!subject && stripped.length > 0 && stripped.length < 60) {
    subject = stripped;
  }

  return { subject, format };
}

function parseAnswer(answerText) {
  if (!answerText) return { clean: '', alternates: [] };

  // Remove common prefixes
  let clean = answerText.replace(/^(answer|ans)[:\s]*/i, '').trim();

  // Extract alternates in parentheses or after "or"/"/"
  const alternates = [];
  const orMatch = clean.match(/(.+?)\s*(?:or|\/)\s*(.+)/i);
  if (orMatch) {
    alternates.push(orMatch[2].trim());
    clean = orMatch[1].trim();
  }

  // Remove bracketed hints like [accept: ...]
  clean = clean.replace(/\[.*?\]/g, '').trim();

  return { clean, alternates };
}

function guessSubject(text) {
  const lower = text.toLowerCase();
  if (/(cell|dna|protein|enzyme|organism|species|photosynthesis|mitosis)/i.test(lower)) return 'Biology';
  if (/(element|compound|reaction|acid|base|molecule|electron|atom)/i.test(lower)) return 'Chemistry';
  if (/(force|velocity|acceleration|momentum|energy|wave|light|gravity)/i.test(lower)) return 'Physics';
  if (/(planet|star|orbit|solar|galaxy|comet|asteroid)/i.test(lower)) return 'Space';
  if (/(rock|mineral|earthquake|volcano|tectonic|weather|climate)/i.test(lower)) return 'Earth Science';
  if (/(integral|derivative|equation|matrix|polynomial|triangle)/i.test(lower)) return 'Math';
  if (/(algorithm|program|binary|computer|software|hardware)/i.test(lower)) return 'Computer Science';
  return 'General Science';
}

/**
 * Fuzzy match for typed answers
 */
/**
 * For "identify/select/order all" questions, extract the numbers/tokens from an answer
 * and compare them as unordered sets (or ordered for "order" questions).
 */
function extractTokens(s) {
  // Remove connectors: "and", "or", commas, semicolons, slashes, spaces — return digit/word tokens
  return s.toLowerCase().replace(/\band\b/g, ' ').replace(/[,;/\s]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

function isSelectAllQuestion(questionText) {
  return /\b(identify all|select all|name all|list all|which of the following)\b/i.test(questionText || '');
}

function isOrderingQuestion(questionText) {
  return /\b(order all|rank all|order the following|rank the following|arrange|sort)\b/i.test(questionText || '');
}

/** Extract just the numeric digits from a string, in order, ignoring all punctuation/spaces */
function extractOrderedNumbers(s) {
  return s.match(/\d+/g) || [];
}

/**
 * Map common ordinal/cardinal words to digits for "select all" matching.
 * Also handles "all" meaning all of the options listed.
 */
function normalizeSelectToken(t) {
  const map = { 'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
                'first': '1', 'second': '2', 'third': '3', 'fourth': '4', 'fifth': '5' };
  return map[t] || t;
}

const NUMBER_WORDS = {
  'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
  'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10',
};

/** Lowercase, strip punctuation, collapse whitespace — for phrase comparisons. */
function normalizePhrase(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "None"-style answers: no listed choice is correct ("none", "none of the above", "0"). */
function isNoneAnswer(s) {
  return /^(none( of (the above|them|these))?|no (answers?|choices?|options?|items?)( (are|is) correct)?|zero|0)$/
    .test(normalizePhrase(s));
}

/** "All"-style shorthand answers ("all", "all of the above", "all of them"). */
function isAllAnswer(s) {
  return /^(all( of (the above|them|these))?|all (answers?|choices?|options?|items?)( (are|is) correct)?)$/
    .test(normalizePhrase(s));
}

/**
 * Parse a string that is purely a list of choice numbers — "1, 2", "1 and 3",
 * "2; 3", "1,2 and 4", "one and three" — into number tokens in the order
 * written. Connector/filler words (and/then/only) and comma/semicolon/space
 * separators are ignored; any other content means the string is NOT a pure
 * number list and null is returned. Slash is deliberately not a separator so
 * fractions like "1/2" stay numeric answers.
 */
function parseNumberList(s) {
  const cleaned = String(s).toLowerCase().replace(/\b(and|then|only)\b/g, ' ');
  const parts = cleaned.split(/[\s,;]+/).filter(Boolean).map(p => NUMBER_WORDS[p] || p);
  if (parts.length === 0) return null;
  if (!parts.every(p => /^\d+$/.test(p))) return null;
  return parts;
}

/** Extract numbered options from question text, e.g. "1) foo 2) bar, 3) baz"
 *  → {1:'foo',2:'bar',3:'baz'}. Markers are "1)", "2)", … and the numbering
 *  must run 1..n, otherwise {} is returned (protects against stray digits). */
function extractNumberedOptions(text) {
  if (!text) return {};
  const re = /(?:^|[\s,;:])(\d{1,2})\s*\)\s*/g;
  const marks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    marks.push({ num: m[1], start: m.index, end: re.lastIndex });
  }
  if (marks.length === 0) return {};
  const opts = {};
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].start : text.length;
    opts[marks[i].num] = text.slice(marks[i].end, end).replace(/[,;.\s]+$/, '').trim();
  }
  const nums = Object.keys(opts).map(Number).sort((a, b) => a - b);
  if (nums[0] !== 1 || nums.some((n, i) => n !== i + 1)) return {};
  return opts;
}

/** Convert a user answer (mixed numbers/option-texts) into an array of option numbers */
function userAnswerToNumbers(userAnswer, options) {
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = userAnswer.split(/[,;/]|\band\b|\bor\b/).map(t => t.trim()).filter(Boolean);
  const nums = [];
  for (const tok of tokens) {
    const nt = normalize(tok);
    if (/^\d+$/.test(nt)) { nums.push(nt); continue; }
    let found = null;
    for (const [num, txt] of Object.entries(options || {})) {
      if (normalize(txt) === nt) { found = num; break; }
    }
    if (found) nums.push(found);
  }
  return nums;
}

function orderingMatch(userAnswer, correctAnswer, options) {
  // Only compare the sequence of numbers — strip ALL non-digit characters from both sides
  const correctNums = extractOrderedNumbers(correctAnswer);
  if (correctNums.length === 0) return false;
  const userNums = extractOrderedNumbers(userAnswer);
  // Also allow concatenated form: "123" == "1, 2, 3"
  if (userNums.length === correctNums.length) {
    return userNums.every((n, i) => n === correctNums[i]);
  }
  // Concatenated single digits: "123" matches [1,2,3]
  const userConcat = userAnswer.replace(/\D/g, '');
  const correctConcat = correctNums.join('');
  if (userConcat === correctConcat) return true;

  // Option-text mapping: user typed the option descriptions instead of numbers (order matters)
  if (options && Object.keys(options).length > 0) {
    const mapped = userAnswerToNumbers(userAnswer, options);
    if (mapped.length === correctNums.length && mapped.every((n, i) => n === correctNums[i])) return true;
  }
  return false;
}

function selectAllMatch(userAnswer, correctAnswer, options) {
  // For select-all: the set of numbers must match (order-independent), ignoring all punctuation/spacing
  const correctNums = extractOrderedNumbers(correctAnswer).sort();
  if (correctNums.length === 0) return false;

  // "all" shorthand: only when the correct answer covers every listed option
  if (isAllAnswer(userAnswer)) {
    const optionNums = Object.keys(options || {});
    if (optionNums.length >= 2) {
      return correctNums.length === optionNums.length && optionNums.every(n => correctNums.includes(n));
    }
    return correctNums.every((n, i) => Number(n) === i + 1) && correctNums.length >= 2;
  }

  const userNums = extractOrderedNumbers(userAnswer).sort();
  if (userNums.length === correctNums.length && userNums.every((n, i) => n === correctNums[i])) {
    return true;
  }

  // Concatenated single digits: "23" matches {2,3}
  const userConcat = userAnswer.replace(/\D/g, '');
  const correctConcat = [...correctNums].sort().join('');
  if (userConcat === correctConcat) return true;

  // Option-text mapping: user typed option descriptions instead of numbers (order-independent)
  if (options && Object.keys(options).length > 0) {
    const mapped = userAnswerToNumbers(userAnswer, options).sort();
    if (mapped.length === correctNums.length && mapped.every((n, i) => n === correctNums[i])) return true;
  }

  // Fallback: token-based text match for non-numeric select-all answers
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const userTokens = extractTokens(normalize(userAnswer)).map(normalizeSelectToken).sort();
  const correctTokens = extractTokens(normalize(correctAnswer)).map(normalizeSelectToken).sort();
  if (userTokens.length !== correctTokens.length) return false;
  return userTokens.every((t, i) => t === correctTokens[i]);
}

/**
 * Try to parse a string as a numeric value, handling fractions, scientific notation,
 * and common written forms like "1/2", "3.14", "6.02 x 10^23".
 * Returns a Number or null if not parseable.
 */
function parseNumeric(s) {
  if (!s) return null;
  const t = s.trim()
    // handle × / x as multiplication (scientific notation: "6.02 x 10^23")
    .replace(/\s*[×x]\s*10\s*\^?\s*(-?\d+)/i, (_, exp) => `e${exp}`)
    // handle "* 10^n"
    .replace(/\s*\*\s*10\s*\^?\s*(-?\d+)/i, (_, exp) => `e${exp}`);

  // Fraction: "a/b"
  const fracMatch = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/);
  if (fracMatch) {
    const num = parseFloat(fracMatch[1]);
    const den = parseFloat(fracMatch[2]);
    return den !== 0 ? num / den : null;
  }

  const n = Number(t.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

function isNumericAnswer(correctAnswer) {
  return parseNumeric(correctAnswer) !== null;
}

/** A "single number" answer — pure integer/decimal, no units or words. */
function isSingleNumber(s) {
  return /^\s*-?\d+(?:\.\d+)?\s*$/.test(String(s));
}

/**
 * Strict matcher for number-list answers ("1, 2", "3, 1, 2"): the numbers the
 * user gives must match the correct list in BOTH value and order.
 *
 * Accepted variations: any capitalization; comma/semicolon/"and"/space
 * separators; digit words ("one and three"); typing the option descriptions
 * instead of their numbers (in the same order); an unseparated digit string
 * ("12" for "1, 2") when every correct number is a single digit; and
 * "all"/"all of the above" when the correct answer covers every option listed
 * in the question in ascending order.
 */
function numberListMatch(userAnswer, correctList, options) {
  const optionNums = Object.keys(options || {});

  if (isAllAnswer(userAnswer)) {
    // "all" only stands in for a list in ascending display order that covers
    // every option in the question (or 1..n when the options can't be parsed)
    const ascending = correctList.every((n, i) => i === 0 || Number(correctList[i - 1]) < Number(n));
    if (!ascending) return false;
    if (optionNums.length >= 2) {
      return correctList.length === optionNums.length && optionNums.every(n => correctList.includes(n));
    }
    return correctList.every((n, i) => Number(n) === i + 1);
  }

  let userList = parseNumberList(userAnswer);

  // Unseparated digits ("312" for "3, 1, 2") are unambiguous only when every
  // correct number is a single digit
  if (userList && userList.length === 1 && userList[0].length > 1 &&
      correctList.every(n => n.length === 1)) {
    userList = userList[0].split('');
  }

  // The user may type the option descriptions instead of their numbers
  if (!userList && optionNums.length > 0) {
    const mapped = userAnswerToNumbers(userAnswer, options);
    if (mapped.length > 0) userList = mapped;
  }

  if (!userList) return false;
  return userList.length === correctList.length && userList.every((n, i) => n === correctList[i]);
}

function numericMatch(userAnswer, correctAnswer) {
  const ua = parseNumeric(userAnswer);
  const ca = parseNumeric(correctAnswer);
  if (ua === null || ca === null) return false;
  // Exact equality (handles floating-point forms of the same value)
  // Use relative tolerance only for float imprecision, not for "close enough"
  if (ca === 0) return ua === 0;
  return Math.abs(ua - ca) / Math.abs(ca) < 1e-9;
}

export function fuzzyMatch(userAnswer, correctAnswer, alternates = [], questionText = '') {
  if (!userAnswer || !correctAnswer) return false;

  // ── Single-number answers: the submitted number must equal the correct one ──
  if (isSingleNumber(correctAnswer)) {
    const cleanedUser = String(userAnswer).replace(/\bonly\b/gi, '').trim(); // "1 only" → "1"
    if (isSingleNumber(cleanedUser) && parseNumeric(cleanedUser) === parseNumeric(correctAnswer)) return true;
    // An answer of 0 in a choose-among-numbered-items question means "none"
    if (parseNumeric(correctAnswer) === 0 && isNoneAnswer(userAnswer)) return true;
    if (alternates?.some(alt => isSingleNumber(alt) && isSingleNumber(cleanedUser) && parseNumeric(cleanedUser) === parseNumeric(alt))) return true;
    return false;
  }

  // ── "None" answers: no listed choice is correct ────────────────────────────
  // Accept "none", "none of the above/them", "0", "zero" — nothing else.
  if (isNoneAnswer(correctAnswer)) {
    if (isNoneAnswer(userAnswer)) return true;
    return Boolean(alternates?.some(alt => normalizePhrase(alt) === normalizePhrase(userAnswer)));
  }

  // ── Number-list answers ("1, 2" / "1 and 3" / "3, 1, 2"): strict match ─────
  // For identify-all / order-all questions the value AND order of the numbers
  // must match the correct answer exactly. Separator style ("," / ";" / "and"),
  // spacing, and capitalization are forgiven; "all"/"none" shorthands are
  // handled inside numberListMatch / above.
  const correctList = parseNumberList(correctAnswer);
  if (correctList && correctList.length >= 2) {
    const options = extractNumberedOptions(questionText);
    if (numberListMatch(userAnswer, correctList, options)) return true;
    if (alternates?.some(alt => {
      if (isNoneAnswer(alt)) return isNoneAnswer(userAnswer);
      const altList = parseNumberList(alt);
      return altList && numberListMatch(userAnswer, altList, options);
    })) return true;
    return false; // strict — do NOT fall through to fuzzy text matching
  }

  // ── Numeric answers: exact match only ─────────────────────────────────────
  if (isNumericAnswer(correctAnswer)) {
    if (numericMatch(userAnswer, correctAnswer)) return true;
    if (alternates?.some(alt => isNumericAnswer(alt) && numericMatch(userAnswer, alt))) return true;
    return false; // no fuzzy for numbers
  }

  // Ordering questions: only compare digit sequence (numbers OR option descriptions)
  if (isOrderingQuestion(questionText)) {
    const options = extractNumberedOptions(questionText);
    if (orderingMatch(userAnswer, correctAnswer, options)) return true;
    if (alternates?.some(alt => orderingMatch(userAnswer, alt, options))) return true;
    return false;
  }

  // Check for "select all / identify all" style questions
  if (isSelectAllQuestion(questionText)) {
    const options = extractNumberedOptions(questionText);
    if (selectAllMatch(userAnswer, correctAnswer, options)) return true;
    if (alternates?.some(alt => selectAllMatch(userAnswer, alt, options))) return true;
  }

  // Normalize: lowercase, strip punctuation, collapse whitespace
  const normalize = (s) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const ua = normalize(userAnswer);
  const ca = normalize(correctAnswer);

  // Exact match after normalization
  if (ua === ca) return true;

  // Check alternates (exact after normalize)
  if (alternates.some(alt => normalize(alt) === ua)) return true;

  // Levenshtein distance — allow up to 20% edit distance, min 1 char slack for short answers
  const dist = levenshtein(ua, ca);
  const threshold = Math.max(1, Math.floor(ca.length * 0.2));
  if (dist <= threshold) return true;

  // Alternates with levenshtein
  if (alternates.some(alt => levenshtein(normalize(alt), ua) <= Math.max(1, Math.floor(normalize(alt).length * 0.2)))) return true;

  // Key-word containment: user answer contains all significant words of the correct answer
  const sigWords = ca.split(' ').filter(w => w.length > 3);
  if (sigWords.length > 0 && sigWords.every(w => ua.includes(w))) return true;

  // Partial match: most significant words present (≥ 80%)
  const matchedWords = sigWords.filter(w => ua.includes(w));
  if (sigWords.length >= 2 && matchedWords.length / sigWords.length >= 0.8) return true;

  return false;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Science Bowl scoring
 * Tossup correct: +4 (MC), +4 (SA)
 * Tossup interrupt correct: +4 — or TOSSUP_POWER when powers are enabled
 * Tossup interrupt wrong: -4
 * Bonus correct: +10
 * No penalty for not buzzing
 *
 * Powers are an optional house rule: answering a tossup correctly before the
 * reading finishes is worth TOSSUP_POWER instead of the usual +4. Official
 * Science Bowl has no such award, so games played with it are scored as custom
 * games (see PostGameActions / LeaderboardSection).
 */
export const SCORING = {
  TOSSUP_CORRECT: 4,
  TOSSUP_POWER: 6,
  TOSSUP_INTERRUPT_WRONG: -4,
  BONUS_CORRECT: 10,
  BONUS_WRONG: 0,
};

/**
 * Points for a single answered question. The one place that knows the rules —
 * scoreboards, results screens, the review dialog and the CSV export all go
 * through it so a rule change (like powers) can't apply in some views only.
 *
 * @param result       'correct' | 'wrong' | 'interrupt_wrong' | 'timeout' | 'dead'
 * @param type         'TOSSUP' | 'BONUS'
 * @param interrupted  answered before the reading finished
 * @param powers       power scoring enabled for this game
 */
export function pointsFor(result, type, { interrupted = false, powers = false } = {}) {
  if (result === 'correct') {
    if (type === 'BONUS') return SCORING.BONUS_CORRECT;
    return powers && interrupted ? SCORING.TOSSUP_POWER : SCORING.TOSSUP_CORRECT;
  }
  if (result === 'interrupt_wrong') return SCORING.TOSSUP_INTERRUPT_WRONG;
  return 0;
}

/**
 * What a player submitted for a question, as display text. Multiple choice
 * renders as the option picked ("X) 4.2 joules") rather than the bare letter or
 * the raw keystrokes, so it reads the same whether they clicked or typed.
 * Returns null when nothing was submitted (the clock ran out) — callers show
 * "No answer given" for that case rather than an empty string.
 */
export function submittedText(entry, question) {
  if (!entry) return null;
  const letter = entry.submitted_choice;
  if (letter && question?.choices?.[letter]) return `${letter}) ${question.choices[letter]}`;
  if (letter) return letter;
  const raw = entry.submitted_answer;
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
}

export function calculateScore(results, { powers = false } = {}) {
  return results.reduce(
    (sum, r) => sum + pointsFor(r.result, r.type, { interrupted: r.interrupted, powers }),
    0,
  );
}

/**
 * Boss-ups: play a bonus as if it were a tossup. The question is still read,
 * but it is open to everyone from the first word — interrupts, powers and negs
 * all apply — and it scores like a tossup rather than +10.
 *
 * Done by rewriting the question's type rather than threading a flag through
 * the reader, the scorer and the bonus-ownership rules: every one of those
 * already does the right thing for a TOSSUP, and a second code path through
 * them is how the two drift apart. `boss_up` is kept for display and for the
 * longer buzz window.
 */
export function asBossUp(q) {
  if (!q || q.type !== 'BONUS') return q;
  return { ...q, type: 'TOSSUP', boss_up: true, original_type: 'BONUS' };
}

/** Extra seconds to buzz on a boss-up, over the tossup window. */
export const BOSS_UP_EXTRA_SECONDS = 10;

/**
 * The question list a game actually plays: subject filter, then either
 * boss-ups or skipped bonuses. Shared by solo and multiplayer so both derive
 * the same list from the same settings — in multiplayer they must, since every
 * client indexes into its own copy.
 */
export function applyQuestionRules(questions, settings) {
  let qs = questions || [];
  if (settings?.subjects?.length > 0) qs = qs.filter(q => settings.subjects.includes(q.subject));
  // Boss-ups win over skipping: turning bonuses into tossups and then dropping
  // them would leave nothing to convert.
  if (settings?.boss_ups) return qs.map(asBossUp);
  if (settings?.skip_bonuses) qs = qs.filter(q => q.type === 'TOSSUP');
  return qs;
}

/**
 * Position labels for a question list, counted the way a packet is written:
 * a tossup and the bonus that follows it are one numbered pair, so 46 questions
 * are 23 pairs. Tossups read "12.T", bonuses "12.B" — and a boss-up is still a
 * bonus for numbering, whatever its type was rewritten to, because it occupies
 * the same slot in the packet.
 *
 * Derived from position rather than from `number`: parsed packets number
 * inconsistently, and a filtered list (subject filter, skipped bonuses) has to
 * come out contiguous anyway.
 *
 * @returns {{ labels: string[], totalPairs: number }} labels index-aligned with
 *          `questions`.
 */
export function pairPositions(questions = []) {
  const labels = [];
  let pair = 0;
  for (const q of questions) {
    // A boss-up reports type TOSSUP; original_type is what the packet had.
    const isBonus = (q?.original_type || q?.type) === 'BONUS';
    if (isBonus) {
      // A packet that opens on a bonus (or a bonus-only filter) still starts at 1.
      if (pair === 0) pair = 1;
    } else {
      pair++;
    }
    labels.push(`${pair}.${isBonus ? 'B' : 'T'}`);
  }
  return { labels, totalPairs: pair };
}

/**
 * Multiplayer: how many wrong answers kill a tossup, by format.
 * A multiple-choice question is guessable — after two wrong answers the field
 * is narrow enough that the next team would be picking between two options —
 * so it locks out earlier than short answer.
 *
 * The server enforces this (server/match.js keeps a matching copy, since it
 * can't import browser code); this copy lets the UI show the lockout the
 * moment the answer lands rather than waiting for the round trip.
 */
export const DEAD_AFTER_WRONG = {
  'Multiple Choice': 2,
  DEFAULT: 3,
};

export function wrongLimitFor(format) {
  return DEAD_AFTER_WRONG[format] ?? DEAD_AFTER_WRONG.DEFAULT;
}

export const SUBJECTS = [
  'Biology', 'Chemistry', 'Physics', 'Earth and Space',
  'Math', 'Energy', 'General Science'
];

export const SUBJECT_COLORS = {
  'Biology': 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  'Chemistry': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  'Physics': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  'Earth and Space': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  // legacy aliases kept for old records
  'Earth Science': 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  'Space': 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  'Math': 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
  'Computer Science': 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
  'General Science': 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
  'Energy': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
};

/**
 * Sort key for organizing rounds within a competition (RR first, then DE, then
 * generic rounds), each in increasing round number — NOT by upload date.
 */
export function roundSortKey(title = '') {
  const t = String(title).toLowerCase();
  let group = 2;
  if (/\b(rr|round\s*robin)\b/.test(t)) group = 0;
  else if (/\b(de|double\s*elim)/.test(t)) group = 1;
  const m = t.match(/(\d+)/);
  const num = m ? parseInt(m[1], 10) : 9999;
  return { group, num, title: t };
}

export function sortRoundsByNumber(arr) {
  return [...arr].sort((a, b) => {
    const ka = roundSortKey(a.title);
    const kb = roundSortKey(b.title);
    if (ka.group !== kb.group) return ka.group - kb.group;
    if (ka.num !== kb.num) return ka.num - kb.num;
    return ka.title.localeCompare(kb.title);
  });
}