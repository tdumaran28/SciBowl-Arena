// Default content for the Help & Guide page.
//
// The live page loads its content from the HelpContent entity (Supabase table
// `help_content`) and falls back to this bundled default when no record
// exists. Seed or refresh the stored copy with: npm run seed:help
//
// The structure is plain JSON-serializable data rendered by src/views/Help.jsx.
// Text fields support **bold** and `code` inline markup. `icon` values must be
// names present in the ICONS map in Help.jsx.

export const LLM_CONVERSION_PROMPT = `You are converting a Science Bowl packet into JSON for the SciBowl Arena app.

Output ONE valid JSON object in exactly this shape — no markdown fences, no commentary:

{
  "set_name": "2024 NSB Regionals",
  "set_round": "Round 5",
  "set_year": "2024",
  "questions": [
    {
      "question_number": "1",
      "toss_bonus": "toss-up",
      "subject": "Biology",
      "question_type": "Multiple Choice",
      "question_text": "Which organelle produces most of a cell's ATP? W) Nucleus X) Mitochondrion Y) Ribosome Z) Golgi apparatus",
      "answer": "X) Mitochondrion",
      "answer_variations": []
    },
    {
      "question_number": "1",
      "toss_bonus": "bonus",
      "subject": "Biology",
      "question_type": "Short Answer",
      "question_text": "What high-energy molecule is the main product of cellular respiration?",
      "answer": "ATP",
      "answer_variations": ["adenosine triphosphate"]
    }
  ]
}

Rules:
1. Include EVERY question from the packet, in the original order and wording — do not paraphrase, skip, or renumber. A toss-up and its bonus share the same question_number.
2. toss_bonus is exactly "toss-up" or "bonus". question_type is exactly "Multiple Choice" or "Short Answer".
3. subject is one of: Biology, Chemistry, Physics, Earth and Space, Math, Energy, General Science.
4. Multiple Choice: keep all four choices inside question_text, each introduced by "W)", "X)", "Y)", "Z)". The answer must start with the correct letter — "X" and "X) Mitochondrion" both work.
5. Short Answer: put the packet's printed answer in "answer" (packets usually print it in ALL CAPS). Fill answer_variations with accepted alternates: abbreviations, full names, alternate spellings, and the value with and without units.
6. "Identify all …" / "Order the following …" questions: number the items inside question_text as "1) … 2) … 3) …". The answer is the item numbers IN THE REQUIRED ORDER, separated by commas — e.g. "1, 3" or "3, 1, 2". Use "NONE" if no item qualifies. The app grades these strictly on both value and order.
7. Write math in plain text, never LaTeX: scientific notation as "6.02 x 10^23", fractions as "3/4", powers as "x^2", units spelled out or abbreviated as in the packet.
8. Escape quotes and special characters so the JSON parses; no trailing commas.

Packet text:
[PASTE PACKET TEXT HERE]`;

export const JSON_SHAPE_EXAMPLE = `{
  "set_name": "NSB 2024",
  "set_round": "Round 5",
  "set_year": "2024",
  "questions": [
    {
      "question_number": "1",
      "toss_bonus": "toss-up",
      "subject": "Biology",
      "question_type": "Multiple Choice",
      "question_text": "... W) ... X) ... Y) ... Z) ...",
      "answer": "X",
      "answer_variations": []
    },
    {
      "question_number": "1",
      "toss_bonus": "bonus",
      "subject": "Biology",
      "question_type": "Short Answer",
      "question_text": "...",
      "answer": "ATP",
      "answer_variations": ["adenosine triphosphate"]
    }
  ]
}`;

export const DEFAULT_HELP_CONTENT = {
  header: {
    title: 'Help & Guide',
    subtitle: 'Everything you need to know about Science Bowl and SciBowl Arena',
  },

  sections: [
    {
      id: 'sciencebowl',
      navLabel: 'Science Bowl',
      icon: 'Atom',
      color: 'text-primary',
      bg: 'bg-primary/10',
      title: 'Science Bowl — How it Works',
      blocks: [
        {
          type: 'p',
          text: '**Science Bowl** is a fast-paced academic quiz competition run by the U.S. Department of Energy (DOE). Teams of students compete in a buzzer format covering six core science subjects plus math. SciBowl Arena is a digital practice platform built around this format.',
        },
        { type: 'label', text: 'Subjects Covered' },
        {
          type: 'badges',
          items: [
            { label: 'Biology', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' },
            { label: 'Chemistry', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' },
            { label: 'Physics', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' },
            { label: 'Earth & Space', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' },
            { label: 'Math', color: 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300' },
            { label: 'Energy', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300' },
            { label: 'General Science', color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300' },
          ],
        },
        { type: 'label', text: 'Question Types' },
        {
          type: 'cards',
          columns: 2,
          items: [
            {
              badge: 'TOSSUP',
              badgeVariant: 'default',
              title: 'Individual question',
              text: 'A reader reads the question aloud. Any player on either team may **buzz in at any time** — even before the question finishes. If correct, their team earns points and gets the bonus. If wrong before the question ends (an **interrupt**), their team is penalized.',
              points: [
                { text: '+4 pts correct', tone: 'good' },
                { text: '−4 pts wrong interrupt', tone: 'bad' },
              ],
            },
            {
              badge: 'BONUS',
              badgeVariant: 'secondary',
              title: 'Team follow-up',
              text: 'Only the team that correctly answered the tossup gets the bonus. The entire team may confer before answering. The question is read in full — no buzzing. **No penalty** for wrong answers on bonuses.',
              points: [
                { text: '+10 pts correct', tone: 'good' },
                { text: '0 pts wrong', tone: 'muted' },
              ],
            },
          ],
        },
        { type: 'label', text: 'Question Formats' },
        {
          type: 'grid',
          items: [
            { title: 'Multiple Choice (MC)', text: 'Four answer options labeled **W, X, Y, Z** (not A, B, C, D). The reader reads all choices. You must answer with the correct letter.' },
            { title: 'Short Answer (SA)', text: 'No choices given. You must provide the exact (or close) answer. Common in math and precise factual recall questions. Some SA questions list numbered items and ask you to **identify all** that qualify or put them **in order** — see Answer Matching under Solo Play.' },
          ],
        },
        { type: 'label', text: 'Match Structure' },
        { type: 'p', small: true, text: 'A standard Science Bowl match consists of **tossup–bonus pairs** numbered 1–20. Each round packet contains 20 pairs (40 questions). Tossup and bonus for the same number are linked — only the team that got the tossup right can attempt that bonus.' },
        { type: 'label', text: 'Interrupt Strategy' },
        { type: 'p', small: true, text: 'Buzzing in early on a tossup before the question finishes is called an **interrupt** or **power buzz**. It\'s risky (−4 if wrong) but lets you score faster and block the opposing team. Good competitors listen for key clues in the question lead-in to identify the answer early.' },
        { type: 'info', color: 'amber', text: '**Tip:** Science Bowl questions are often written with harder clues first and easier clues at the end ("pyramidal" style). Buzz as soon as you\'re confident — waiting lets opponents steal.' },
      ],
    },

    {
      id: 'platform',
      navLabel: 'Platform Features',
      icon: 'Brain',
      color: 'text-violet-500',
      bg: 'bg-violet-500/10',
      title: 'How SciBowl Arena Supports Gameplay',
      blocks: [
        { type: 'p', text: 'SciBowl Arena mirrors the real competition format digitally, so you can practice exactly as you\'d play. Here\'s how each feature maps to real gameplay:' },
        {
          type: 'cards',
          columns: 1,
          items: [
            { icon: 'Play', iconColor: 'text-emerald-500', title: 'Word-by-Word Reading Mode', text: 'Simulates a live reader. Words appear one at a time at your chosen WPM. You can interrupt (buzz) at any point — just like pressing a physical buzzer. This trains your pattern-recognition and buzz timing under realistic pressure.' },
            { icon: 'Zap', iconColor: 'text-primary', title: 'Buzzer Simulation', text: 'Press `Space` to buzz in mid-question. The question pauses, the timer starts, and you have a grace period to answer. In multiplayer, the buzzer is shared — first to press locks out others, just like a real match.' },
            { icon: 'Users', iconColor: 'text-violet-500', title: 'Multiplayer Mode', text: 'Host a room and invite teammates. Players are optionally organized into teams. The first person to buzz gets control of the tossup. If they answer correctly, their team gets the bonus. Scores update live on a shared leaderboard — just like a real match table.' },
            { icon: 'BarChart2', iconColor: 'text-blue-500', title: 'Performance Tracking', text: 'After every solo game, your stats are automatically saved: score, accuracy, subject breakdown, and game history. Visit **My Profile** to review your progress over time and identify weak subjects to focus on.' },
            { icon: 'Star', iconColor: 'text-amber-500', title: 'LLM-Assisted Packet Creation', text: 'Use the ready-made prompt in the **Round Library** section below with any capable LLM (ChatGPT, Claude, Gemini) to convert an existing packet — or generate a brand-new practice round — as importable JSON. Great for custom drills and topic-specific warmups.' },
          ],
        },
        { type: 'info', color: 'blue', text: '**Practice tip:** Use Solo Play at 250–300 WPM (real competition pace) with word-by-word mode and timed buzz window to simulate actual match conditions as closely as possible.' },
      ],
    },

    {
      id: 'library',
      navLabel: 'Round Library',
      icon: 'Database',
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
      title: 'Round Library — Uploading Packets',
      blocks: [
        { type: 'p', text: 'The **Round Library** stores all your Science Bowl packets. Upload once, practice forever. Packets and their parsed questions are stored in the cloud (Supabase), so they survive restarts and are available from anywhere.' },
        {
          type: 'cards',
          columns: 1,
          items: [
            { icon: 'Upload', iconColor: 'text-primary', title: 'PDF / DOCX Upload', text: 'Drop any official Science Bowl packet PDF or Word document. The app automatically extracts and parses all questions, choices, and answers, and stores the original file in cloud storage.' },
          ],
        },
        { type: 'info', color: 'amber', text: '💡 Automatic parsing works best with standard NSB/DOE formatted packets. Scanned (image-only) PDFs cannot be parsed — use JSON import instead.' },
        { type: 'label', text: 'JSON Import' },
        { type: 'p', small: true, text: 'Upload a `.json` file or paste raw JSON in the **JSON Import** tab. This is the most flexible option — any packet an LLM can read can be converted. Required shape:' },
        { type: 'code', code: JSON_SHAPE_EXAMPLE },
        {
          type: 'prompt',
          title: '💡 Copy-paste prompt: convert any packet with an LLM (ChatGPT, Claude, Gemini)',
          text: LLM_CONVERSION_PROMPT,
        },
        { type: 'info', color: 'violet', text: '**Generate instead of convert:** to create a brand-new practice round, keep the same prompt but replace everything after "Packet text:" with — "Instead of converting, write 10 original toss-up/bonus pairs about [SUBJECT] at [middle school / Regional / National] difficulty. Follow every rule above and double-check each fact before including it."' },
        {
          type: 'cards',
          columns: 1,
          items: [
            { icon: 'Settings', iconColor: 'text-primary', title: 'Manual Creation & Editing', text: 'Use the **Create Question Set** button in the library for a built-in editor, or click the pencil icon on any round to fix parsing mistakes, add answer variations, or write questions by hand.' },
          ],
        },
        { type: 'info', color: 'blue', text: '**Visibility:** Each round can be set to **Public** (all users) or **Private** (only you). Toggle the switch on any round card.' },
      ],
    },

    {
      id: 'solo',
      navLabel: 'Solo Play',
      icon: 'Play',
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      title: 'Solo Play',
      blocks: [
        { type: 'p', text: 'Practice any round at your own pace. Pick a packet, configure settings, and drill.' },
        { type: 'label', text: 'Game Settings' },
        {
          type: 'grid',
          items: [
            { title: 'Display Mode', text: 'Word-by-word streams the question like a real reader. Full reveals everything instantly (good for studying, not drilling).' },
            { title: 'Reading Speed', text: 'Words per minute in word-by-word mode. Real competition readers typically go 250–280 WPM.' },
            { title: 'Timed Mode', text: 'After the question finishes reading, a countdown starts. Miss it = question is dead.' },
            { title: 'Buzz Window', text: 'Seconds you have to buzz after the question ends (default 5s). Increase for more relaxed practice.' },
            { title: 'Read Aloud', text: "Uses your browser's TTS to speak questions aloud — helpful for audio-only practice." },
            { title: 'Subject Filter', text: 'Practice only specific subjects. Great for targeted drilling (Bio-only, Chem+Physics, etc.).' },
            { title: 'Skip Bonuses', text: 'Tossup-only mode — maximizes buzz-in reps per session.' },
          ],
        },
        { type: 'label', text: 'Keyboard Shortcuts' },
        {
          type: 'kbds',
          items: [
            { key: 'Space', action: 'Buzz in / Interrupt' },
            { key: 'Enter', action: 'Submit answer' },
            { key: 'N', action: 'Next question' },
            { key: 'P', action: 'Pause / Resume' },
            { key: 'Q', action: 'Quit game' },
          ],
        },
        { type: 'label', text: 'Answer Matching' },
        { type: 'p', small: true, text: 'Typed answers are graded automatically. Word answers get forgiving fuzzy matching; numeric and list answers are graded strictly so you build competition-accurate habits.' },
        {
          type: 'rules',
          items: [
            {
              title: 'Multiple Choice',
              text: 'Type the letter (**W, X, Y, Z**), the full choice text, or a close variant — any capitalization is accepted.',
              examples: [
                { ok: true, text: '"x" → correct for answer X' },
                { ok: true, text: '"mitochondria" → correct for "Mitochondria"' },
                { ok: true, text: '"W) Carbon dioxide" → correct for answer W' },
              ],
            },
            {
              title: 'Short Answer — words',
              text: 'Fuzzy text matching with spelling tolerance (~20% edit distance), so minor typos and capitalization are forgiven. Add `answer_variations` to a question for legitimate alternate names.',
              examples: [
                { ok: true, text: '"photosinthesis" → accepted for "photosynthesis"' },
                { ok: false, text: 'A completely different phrasing → add it as an answer variation instead' },
              ],
            },
            {
              title: 'Short Answer — numbers',
              text: 'Numeric answers must match exactly (fractions and scientific notation are understood — "1/2" equals "0.5").',
              examples: [
                { ok: true, text: '"0.5" → correct for "1/2"' },
                { ok: false, text: '"6.5" → rejected if answer is "6.02"' },
              ],
            },
            {
              title: 'Identify All / Order the Following',
              text: 'For questions whose answer is a list of item numbers ("1, 3" or "3, 1, 2"), grading is **strict: both the values and the order of your numbers must match the answer exactly**. Capitalization and separator style never matter — commas, semicolons, spaces, or "and" all work. Type "all" (or "all of the above") only when every listed item is correct, and "none" or "0" when no item is correct.',
              examples: [
                { ok: true, text: '"1 and 3", "1, 3", "1; 3", "13" → correct for answer "1, 3"' },
                { ok: false, text: '"3, 1" → wrong for answer "1, 3" (order matters)' },
                { ok: true, text: '"all" or "ALL of the above" → correct when the answer is "1, 2, 3" of three items' },
                { ok: true, text: '"none" or "0" → correct when the answer is "NONE"' },
                { ok: false, text: '"all" → wrong when only some items are correct' },
              ],
            },
          ],
        },
        { type: 'label', text: 'Scoring' },
        {
          type: 'tiles',
          items: [
            { value: '+4', label: 'Tossup correct', tone: 'good' },
            { value: '−4', label: 'Early interrupt wrong', tone: 'bad' },
            { value: '+10', label: 'Bonus correct', tone: 'good' },
          ],
        },
      ],
    },

    {
      id: 'multiplayer',
      navLabel: 'Multiplayer',
      icon: 'Users',
      color: 'text-violet-500',
      bg: 'bg-violet-500/10',
      title: 'Multiplayer',
      blocks: [
        { type: 'p', text: 'Compete head-to-head with teammates or friends in real time. One person hosts a room; others join with a 6-character room code.' },
        {
          type: 'steps',
          icon: 'Trophy',
          title: 'How to Host',
          items: [
            'Go to **Multiplayer** and click **Host a Room**.',
            'Enter a display name.',
            'Share the 6-character **Room Code** with other players.',
            'Once everyone is in the lobby, pick a round and configure settings.',
            'Click **Start Game** — only the host can do this.',
          ],
        },
        {
          type: 'steps',
          icon: 'Hash',
          title: 'How to Join',
          items: [
            'Go to **Multiplayer** and click **Join a Room**.',
            'Enter the 6-character room code from the host.',
            'Pick a display name and wait in the lobby.',
            'The host starts the game — buzz in and answer along!',
          ],
        },
        {
          type: 'bullets',
          icon: 'Zap',
          title: 'Gameplay Rules',
          items: [
            'Only the **first player to buzz** in gets to answer the tossup — others are locked out.',
            "If they answer correctly, **that player's team** gets the bonus.",
            'Wrong interrupt = −4 pts for that player; the question continues for others.',
            'If multiple teams neg, the remaining eligible teams can still buzz.',
            'A live team leaderboard and chat are available during the game.',
            'Final scores are shown on the results screen at the end.',
          ],
        },
        { type: 'info', color: 'blue', text: "**Tip:** All players should be on a video/voice call alongside the app for the best experience — there's no built-in voice chat, but the group text chat is available during play." },
      ],
    },

    {
      id: 'tips',
      navLabel: 'Tips & Strategy',
      icon: 'Target',
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      title: 'Tips & Strategy',
      blocks: [
        {
          type: 'cards',
          columns: 2,
          items: [
            { icon: 'Brain', iconColor: 'text-emerald-500', title: 'Learn Question Lead-ins', text: 'Science Bowl questions often give hard clues first. Recognize phrases like "This protein was first isolated by..." and associate them with common answer types. Speed comes from pattern recognition.' },
            { icon: 'Zap', iconColor: 'text-emerald-500', title: 'Practice Interrupts', text: "Use Solo Play at high WPM with word-by-word mode. Try to buzz as early as possible. The interrupt risk trains your confidence calibration — know when you're sure vs. guessing." },
            { icon: 'Target', iconColor: 'text-emerald-500', title: 'Focus on Weak Subjects', text: 'Check your Profile page for per-subject accuracy. If your Physics accuracy is 50% but Bio is 90%, spend more time drilling Physics packets.' },
            { icon: 'BookOpen', iconColor: 'text-emerald-500', title: 'Drill Specific Topics with an LLM', text: 'Use the LLM prompt in the Round Library section to generate topic-specific drills — e.g. ask for "10 hard Biology pairs on cell respiration" — then import the JSON for hyper-targeted practice.' },
            { icon: 'Users', iconColor: 'text-emerald-500', title: 'Simulate Real Matches', text: "Host multiplayer sessions with your team on the same rounds you'll face in competition. Discussing bonus answers together is a key part of Science Bowl teamwork." },
            { icon: 'BarChart2', iconColor: 'text-emerald-500', title: 'Track Progress Over Time', text: 'Save post-game notes in the results screen to remember what topics tripped you up. Your profile logs full game history so you can see improvement over weeks.' },
          ],
        },
      ],
    },

    {
      id: 'faq',
      navLabel: 'FAQ',
      icon: 'BookOpen',
      color: 'text-orange-500',
      bg: 'bg-orange-500/10',
      title: 'FAQ',
      blocks: [
        {
          type: 'faq',
          items: [
            {
              q: 'My PDF uploaded but shows 0 questions — what went wrong?',
              a: 'The parser works best with standard DOE/NSB formatted packets. Scanned PDFs (image-only) cannot be parsed. Convert the packet to JSON with the LLM prompt in the Round Library section, or use the Edit button to add questions manually.',
            },
            {
              q: 'Can I edit questions after uploading?',
              a: 'Yes! Click the pencil (✏️) icon on any round card to open the Round Editor, where you can add, remove, or fix individual questions and their answer variations.',
            },
            {
              q: 'How do I import many rounds at once (e.g., from Base44 or a spreadsheet)?',
              a: 'Use the bulk import script that ships with the app: `npm run import:rounds -- <file.csv|file.json>`. It accepts a Base44 Round export (CSV or JSON), a question-per-row spreadsheet CSV, or packet JSON files, and can also pull straight from the Base44 API. Run it with `--dry-run` first to preview.',
            },
            {
              q: 'What does "Dead" mean during a question?',
              a: 'If no one buzzes in before the buzz-window countdown hits zero, the question is marked "dead." No points are awarded. Click Reveal to see the answer.',
            },
            {
              q: 'How does the answer get revealed? Can I see it before I answer?',
              a: 'The correct answer is only revealed after you submit an answer, the time runs out, or you click Reveal (on dead questions). It never appears during reading.',
            },
            {
              q: "What if I type the right answer but it's marked wrong?",
              a: 'Word answers get fuzzy matching, but very different phrasings may not match — add alternate answers to the question via the Round Editor. Numeric answers must be exactly right. For identify-all/order questions, both the numbers AND their order must match the answer.',
            },
            {
              q: 'For "identify all" / "order the following" questions, how do I answer?',
              a: 'Type the item numbers in the required order, separated however you like: "1, 3", "1 and 3", "1; 3", or even "13". Order matters — "3, 1" is wrong when the answer is "1, 3". Type "all" only when every item is correct, and "none" or "0" when no item is correct.',
            },
            {
              q: 'Does the app save my performance stats?',
              a: 'Yes — solo play results are saved to your profile automatically after each game and stored in the cloud. Visit My Profile to see your overall accuracy, subject breakdown, and full game history.',
            },
            {
              q: "What's the difference between Public and Private rounds?",
              a: 'Public rounds are visible and playable by all users. Private rounds are only visible to you. Toggle the switch on any round card.',
            },
            {
              q: 'Can I use AI to generate questions?',
              a: 'Yes — copy the LLM prompt from the Round Library section into ChatGPT, Claude, or Gemini and ask it to write original toss-up/bonus pairs instead of converting a packet, then paste the JSON into the JSON Import tab. Always spot-check generated facts before drilling with them.',
            },
            {
              q: 'Can multiplayer rooms be private?',
              a: "Room codes are 6-character random strings — only people you share the code with can join. There's no global room browser, so all rooms are effectively private by default.",
            },
          ],
        },
      ],
    },
  ],

  cta: {
    title: 'Ready to practice?',
    text: 'Upload a packet or convert one with the LLM prompt and start drilling right away.',
    buttons: [
      { label: 'Round Library', href: '/database', icon: 'Database', variant: 'default' },
      { label: 'Solo Play', href: '/play', icon: 'Play', variant: 'outline' },
      { label: 'Multiplayer', href: '/multiplayer', icon: 'Users', variant: 'outline' },
    ],
  },
};

// ── Row-per-section storage ─────────────────────────────────────────────────
// The page document above is stored as one HelpContent record per part rather
// than one giant row: a `header` row, one `section` row per section, and a
// `cta` row. Each record carries { kind, slug, position, content }, where
// `content` holds only that part. `slug` is the stable row identity used by
// the seed script to update a part in place; `position` orders the sections.
//
// Editing one section therefore rewrites one small row, and the Supabase table
// is browsable/editable section by section.

export const HELP_HEADER_SLUG = 'header';
export const HELP_CTA_SLUG = 'cta';

// Sections are spaced out so a hand-inserted section can be given a position
// between two existing ones without renumbering the rest.
const POSITION_STEP = 10;
const CTA_POSITION = 10000;

/** Page document → the HelpContent records that represent it. */
export function splitHelpContent(doc) {
  const rows = [];
  if (doc?.header) {
    rows.push({ kind: 'header', slug: HELP_HEADER_SLUG, position: 0, content: doc.header });
  }
  (doc?.sections || []).forEach((section, i) => {
    rows.push({
      kind: 'section',
      slug: section.id || `section-${i + 1}`,
      position: (i + 1) * POSITION_STEP,
      content: section,
    });
  });
  if (doc?.cta) {
    rows.push({ kind: 'cta', slug: HELP_CTA_SLUG, position: CTA_POSITION, content: doc.cta });
  }
  return rows;
}

/**
 * HelpContent records → the page document, or null when the records don't add
 * up to a usable page (caller falls back to DEFAULT_HELP_CONTENT).
 *
 * Also accepts the pre-split layout — a single row whose `content` is the whole
 * document — so a datastore seeded before the split still renders.
 */
export function assembleHelpContent(records) {
  const rows = (records || []).filter(Boolean);
  if (rows.length === 0) return null;

  const legacy = rows
    .filter(r => Array.isArray(r.content?.sections) && r.content.sections.length > 0)
    .sort((a, b) => String(b.updated_date || '').localeCompare(String(a.updated_date || '')))[0];
  if (legacy) return legacy.content;

  const sections = rows
    .filter(r => r.kind === 'section' && r.content)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(r => r.content);
  if (sections.length === 0) return null;

  return {
    header: rows.find(r => r.kind === 'header')?.content || DEFAULT_HELP_CONTENT.header,
    sections,
    cta: rows.find(r => r.kind === 'cta')?.content || null,
  };
}
