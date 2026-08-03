/**
 * Science Bowl packet parser — pure regex, no LLM.
 *
 * Input : raw text string extracted from a PDF or DOCX
 * Output: array of question objects matching the Round entity schema
 */

// ── Subject normalisation ──────────────────────────────────────────────────
const SUBJECT_MAP = [
  [/earth[\s/&]+space|earth\s+sci(?:ence)?|geolog|geograph|meteorolog|astronomy|astro|space/i, 'Earth and Space'],
  [/biology|bio\b|genetics|ecology|organism|botany|zoology/i, 'Biology'],
  [/chemistry|chem\b/i, 'Chemistry'],
  [/physics|phys\b/i, 'Physics'],
  [/math(?:ematics)?|math\b/i, 'Math'],
  [/energy/i, 'Energy'],
];

function normaliseSubject(raw) {
  if (!raw) return 'General Science';
  for (const [re, name] of SUBJECT_MAP) {
    if (re.test(raw)) return name;
  }
  return 'General Science';
}

// ── Noise removal ──────────────────────────────────────────────────────────
function cleanText(raw) {
  return raw
    // Collapse Windows line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove form-feed / page-break characters
    .replace(/\f/g, '\n')
    // Kill repeated whitespace ON A SINGLE LINE (keep newlines)
    .replace(/[^\S\n]+/g, ' ')
    // Strip standalone page numbers  "- 3 -"  or just "3" on its own line
    .replace(/^\s*-?\s*\d+\s*-?\s*$/gm, '')
    // Trim each line
    .split('\n').map(l => l.trim()).join('\n')
    // Collapse 3+ blank lines → 1
    .replace(/\n{3,}/g, '\n\n');
}

// ── Question boundary regex ────────────────────────────────────────────────
// Matches lines like:
//   "1. TOSSUP"   "TOSSUP 1"   "TOSS-UP 1"   "1 TOSSUP"   "1) BONUS"
const Q_BOUNDARY = /^(?:(\d{1,2})\s*[.):\-]?\s*(TOSS-?UP|BONUS)|(?:(TOSS-?UP|BONUS)\s*(\d{1,2})))/i;

// Subject+format line immediately after the header, e.g.:
//   "Biology - Multiple Choice"   "PHYSICS; Short Answer"
const SUBJECT_LINE = /([A-Za-z][\w\s/&]+?)\s*[-–—;,|]\s*(Multiple\s+Choice|Short\s+Answer|MC|SA)/i;

// Standalone format-only line
const FORMAT_ONLY = /^(Multiple\s+Choice|Short\s+Answer|MC\b|SA\b)\s*$/i;

// MC choice line: "W)" "X." "Y -" "Z:"
const CHOICE_LINE = /^([WXYZ])\s*[).\-:]\s*(.*)/i;

// Answer line
const ANSWER_LINE = /^ANSWER\s*[:.]?\s*(.*)/i;

// ── Main parser ────────────────────────────────────────────────────────────
export function parsePacket(rawText, packetName) {
  const text = cleanText(rawText);
  const lines = text.split('\n');

  // First pass: find all question-header line indices
  const headers = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(Q_BOUNDARY);
    if (m) {
      const num = parseInt(m[1] || m[4]);
      const type = (m[2] || m[3]).toUpperCase().replace('TOSS-UP', 'TOSSUP').replace('TOSSUP','TOSSUP');
      headers.push({ lineIdx: i, num, type });
    }
  }

  if (headers.length === 0) return [];

  const questions = [];

  for (let h = 0; h < headers.length; h++) {
    const { lineIdx, num, type } = headers[h];
    const nextLineIdx = h + 1 < headers.length ? headers[h + 1].lineIdx : lines.length;

    // Slice the lines belonging to this question (exclusive of header line)
    const body = lines.slice(lineIdx + 1, nextLineIdx);

    // ── 1. Pull subject + format from first non-empty line ──────────────
    let subject = '';
    let format = '';
    let bodyStart = 0;

    for (let i = 0; i < Math.min(3, body.length); i++) {
      const l = body[i];
      if (!l) continue;

      const sm = l.match(SUBJECT_LINE);
      if (sm) {
        subject = normaliseSubject(sm[1].trim());
        format = normaliseFormat(sm[2].trim());
        bodyStart = i + 1;
        break;
      }
      // Maybe subject and format are on separate lines
      if (FORMAT_ONLY.test(l)) {
        format = normaliseFormat(l.trim());
        bodyStart = i + 1;
        // check line before for subject
        if (i > 0 && body[i - 1]) subject = normaliseSubject(body[i - 1]);
        break;
      }
      // Subject-only line (no format keyword)
      const subjectOnly = l.match(/^(Biology|Chemistry|Physics|Earth[\w\s/&]+|Math(?:ematics)?|Energy|General\s+Science)\s*$/i);
      if (subjectOnly) {
        subject = normaliseSubject(subjectOnly[1]);
        bodyStart = i + 1;
        break;
      }
    }

    // ── 2. Walk remaining lines to collect question text, choices, answer ─
    let questionLines = [];
    const choices = {};
    let answerText = '';
    let inChoices = false;
    let currentChoiceLetter = null;

    for (let i = bodyStart; i < body.length; i++) {
      const l = body[i];
      if (!l) continue;

      // Answer line
      const am = l.match(ANSWER_LINE);
      if (am) {
        answerText = am[1].trim();
        // Collect continuation lines for the answer (e.g. "ACCEPT: ...")
        for (let j = i + 1; j < body.length; j++) {
          const nl = body[j];
          if (!nl) break;
          // Stop if looks like a new section
          if (/^(TOSS-?UP|BONUS|\d+[.):])/i.test(nl)) break;
          answerText += ' ' + nl.trim();
        }
        break; // done with this question
      }

      // MC choice line
      const cm = l.match(CHOICE_LINE);
      if (cm) {
        inChoices = true;
        currentChoiceLetter = cm[1].toUpperCase();
        choices[currentChoiceLetter] = cm[2].trim();
        continue;
      }

      // Continuation of a multi-line choice
      if (inChoices && currentChoiceLetter && !/^[WXYZ]\s*[).\-:]/i.test(l)) {
        choices[currentChoiceLetter] += ' ' + l;
        continue;
      }

      // Normal question text line
      if (!inChoices) {
        questionLines.push(l);
      }
    }

    const questionText = questionLines.join(' ').trim();
    if (!questionText) continue; // skip empty

    // ── 3. Determine format from evidence if not already set ───────────────
    if (!format) {
      format = Object.keys(choices).length > 0 ? 'Multiple Choice' : 'Short Answer';
    }

    // ── 4. Clean answer ────────────────────────────────────────────────────
    const { answer, answer_alternates } = parseAnswer(answerText);

    // ── 5. Build question record ───────────────────────────────────────────
    questions.push({
      number: num,
      type: type === 'TOSSUP' ? 'TOSSUP' : 'BONUS',
      subject: subject || guessSubject(questionText),
      format,
      question_text: questionText,
      choices: Object.keys(choices).length > 0 ? choices : null,
      answer,
      answer_alternates,
      question_set: packetName,
    });
  }

  return questions;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function normaliseFormat(s) {
  if (/multiple|mc\b/i.test(s)) return 'Multiple Choice';
  if (/short|sa\b/i.test(s)) return 'Short Answer';
  return '';
}

function parseAnswer(raw) {
  if (!raw) return { answer: '', answer_alternates: [] };

  let text = raw.trim();

  // Strip leading "ANSWER:" again if duplicated
  text = text.replace(/^ANSWER\s*[:.]?\s*/i, '').trim();

  // Extract bracketed accepts: [accept X] or (accept X)
  const alternates = [];
  text = text.replace(/[\[(]accept[:\s]+([^\])]]+)[\])]/gi, (_, a) => {
    alternates.push(...a.split(/[,;/]/).map(s => s.trim()).filter(Boolean));
    return '';
  });

  // "X or Y" — treat second part as alternate
  const orMatch = text.match(/^(.+?)\s+or\s+(.+)$/i);
  if (orMatch) {
    alternates.push(orMatch[2].trim());
    text = orMatch[1].trim();
  }

  // Clean trailing punctuation
  text = text.replace(/[;,.]$/, '').trim();

  return { answer: text, answer_alternates: alternates };
}

function guessSubject(text) {
  const t = text.toLowerCase();
  if (/(cell|dna|protein|enzyme|organism|species|photosynthesis|mitosis|gene|chromosome)/i.test(t)) return 'Biology';
  if (/(element|compound|reaction|acid|base|molecule|electron|atom|mol\b|titrat)/i.test(t)) return 'Chemistry';
  if (/(force|velocity|acceleration|momentum|wave|optic|circuit|resistor|magnetic|photon)/i.test(t)) return 'Physics';
  if (/(planet|star|orbit|solar|galaxy|comet|asteroid|eclipse|nebula|moon)/i.test(t)) return 'Earth and Space';
  if (/(rock|mineral|earthquake|volcano|tectonic|weather|climate|sediment|erosion)/i.test(t)) return 'Earth and Space';
  if (/(integral|derivative|equation|matrix|polynomial|triangle|calculus|logarithm)/i.test(t)) return 'Math';
  if (/(energy|renewable|solar panel|fossil fuel|nuclear|turbine|watt|joule\b)/i.test(t)) return 'Energy';
  return 'General Science';
}