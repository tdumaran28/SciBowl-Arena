/**
 * Converts the custom Science Bowl JSON format into the internal Round question schema.
 *
 * Input JSON shape:
 * {
 *   "set_name": string,
 *   "set_round": string,
 *   "set_year": string,
 *   "questions": [
 *     {
 *       "question_number": string | number,   // tossup + bonus for the same set share the same number
 *       "toss_bonus": "toss-up" | "bonus",
 *       "subject": string,
 *       "question_type": "Short Answer" | "Multiple Choice",
 *       "question_text": string,   // MC: may contain "W) ... X) ... Y) ... Z) ..."
 *       "answer": string,
 *       "answer_variations": []
 *     }
 *   ]
 * }
 */

const SUBJECT_MAP = {
  'biology': 'Biology',
  'chemistry': 'Chemistry',
  'physics': 'Physics',
  'earth and space': 'Earth and Space',
  'earth science': 'Earth and Space',
  'earth/space': 'Earth and Space',
  'math': 'Math',
  'mathematics': 'Math',
  'energy': 'Energy',
  'general science': 'General Science',
};

function normaliseSubject(raw) {
  if (!raw) return 'General Science';
  const key = raw.trim().toLowerCase();
  // Return mapped canonical name, or preserve the original value as-is
  return SUBJECT_MAP[key] || raw.trim();
}

/** Normalize raw text: collapse whitespace, remove escape sequences but preserve math content */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\r/g, ' ')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Pull W/X/Y/Z choices out of question_text for MC questions.
 *  Detects markers like "W)" at word boundaries (case-insensitive). */
function extractChoices(text) {
  // Match W) X) Y) Z) as standalone markers (must start at beginning of a token)
  const choiceRe = /\b([WXYZ])\)/gi;
  const splits = [];
  let match;
  while ((match = choiceRe.exec(text)) !== null) {
    splits.push({ letter: match[1].toUpperCase(), index: match.index });
  }

  if (splits.length === 0) return { questionText: text.trim(), choices: null };

  // The question text is everything before the first choice marker
  const questionText = text.slice(0, splits[0].index).trim();
  const choices = {};

  for (let i = 0; i < splits.length; i++) {
    // skip past the "X)" marker itself
    const markerEnd = splits[i].index + 2; // e.g. "W)" is 2 chars
    const end = i + 1 < splits.length ? splits[i + 1].index : text.length;
    choices[splits[i].letter] = text.slice(markerEnd, end).trim().replace(/\s+/g, ' ');
  }

  return { questionText, choices };
}

export function parseJsonPacket(json) {
  // Accept either a parsed object or a raw JSON string
  const data = typeof json === 'string' ? JSON.parse(json) : json;

  const packetName = [data.set_name, data.set_round].filter(Boolean).join(' – ');
  const source = data.set_name || '';
  const year = data.set_year || '';

  const questions = (data.questions || []).map((q, idx) => {
    const isMC = /multiple\s*choice/i.test(q.question_type || '');
    const type = /bonus/i.test(q.toss_bonus || '') ? 'BONUS' : 'TOSSUP';

    // Clean raw text (removes \n, \t, collapse whitespace, etc.)
    let questionText = cleanText(q.question_text || '');
    let choices = null;

    if (isMC) {
      const extracted = extractChoices(questionText);
      questionText = extracted.questionText;
      choices = extracted.choices;
    }

    // Support both "question_number" (new) and "id" (legacy)
    const rawNum = q.question_number !== undefined ? q.question_number : q.id;
    const number = parseInt(rawNum) || idx + 1;

    return {
      number,
      type,
      subject: normaliseSubject(q.subject),
      format: isMC ? 'Multiple Choice' : 'Short Answer',
      question_text: questionText,
      choices,
      answer: cleanText(q.answer || ''),
      answer_alternates: Array.isArray(q.answer_variations)
        ? q.answer_variations.map(s => String(s).trim()).filter(Boolean)
        : [],
      question_set: packetName,
    };
  });

  return { packetName, source, year, questions };
}