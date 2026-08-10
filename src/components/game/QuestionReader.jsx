import { useState, useEffect, useRef, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { SUBJECT_COLORS, fuzzyMatch, pointsFor, BOSS_UP_EXTRA_SECONDS } from '@/utils/parseRound';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Clock, Zap, Hash, Pause, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { serverNow } from '@/lib/clock';

// Which choice a multiple-choice submission refers to — a bare letter, a "W)…"
// prefix, or the choice text typed out. Recorded alongside the raw submission
// so the review screens can show the option the player actually picked.
function resolveChoiceLetter(answer, choices) {
  if (!answer) return null;
  const a = answer.trim();
  const letter = a.match(/^([WXYZ])(?:[).\s]|$)/i);
  if (letter) return letter[1].toUpperCase();
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const target = normalize(a);
  for (const l of ['W', 'X', 'Y', 'Z']) {
    if (choices?.[l] && normalize(choices[l]) === target) return l;
  }
  return null;
}

function checkMCAnswer(answer, correctLetter, choices) {
  if (!answer || !correctLetter) return false;
  const a = answer.trim();
  // Exact letter match (case-insensitive)
  if (a.toUpperCase() === correctLetter) return true;
  // "W) ..." prefix
  const letterPrefix = a.match(/^([WXYZ])[).\s]/i);
  if (letterPrefix && letterPrefix[1].toUpperCase() === correctLetter) return true;
  // Typed out choice text (case-insensitive)
  const correctText = choices?.[correctLetter];
  if (correctText && a.toLowerCase() === correctText.toLowerCase()) return true;
  // Exact choice text only (case/punctuation/space-insensitive, word order preserved)
  if (correctText) {
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalize(a) === normalize(correctText)) return true;
  }
  return false;
}

const ANSWER_GRACE = 10;

export default function QuestionReader({
  question,
  questionIndex,
  totalQuestions,
  // Counter shown top-left. Packets are counted in tossup/bonus pairs, so this
  // is "12.T of 23", not "23 of 46" — the caller owns the numbering because
  // only it holds the whole question list. Falls back to a plain index.
  positionLabel = null,
  totalPositions = null,
  settings,
  onAnswer,
  onNext,
  onPause,
  onQuit,
  isBonusFor = null,
  externalBuzzed = false,
  forceBuzzed = false,
  readOnly = false,
  canAdvance = true,
  onAdvance,
  onBuzz,
  buzzEnabled = true,
  // Multiplayer bonuses: the answer box is open from the start, with no buzz.
  // A bonus belongs to the team that won the tossup and all of them get one, so
  // there is nothing to arbitrate — they confer, and the first to submit is the
  // team's answer. Buzzing for it would let the first teammate to hit the
  // button lock the other three out of their own bonus.
  openAnswer = false,
  // The team the open bonus belongs to, when it belongs to one. Empty in a
  // free-for-all room, where the bonus is the winning player's alone and there
  // is no race with teammates to explain.
  openAnswerTeam = null,
  multiplayer = false,
  resolved = false,
  onDead,
  readingStartedAt = null,
  // Does THIS client read the question out word by word, or just show it?
  //
  // Tossups are always read. A multiplayer bonus is read only to the team it
  // belongs to — they are the only ones who can answer it, so they are the only
  // ones it is being read to. Everyone else gets it as static text, which is
  // what they had before, and no answer box.
  wordByWord = true,
  // The host has paused the match (a server timestamp). Shared, because a local
  // pause would freeze one player's words while the rest of the room read on.
  externalPausedAt = null,
  // Bumped by the parent when the server awards the buzz to someone else.
  // Buzzing is optimistic — the answer box opens on the keypress so the local
  // player feels no delay — so a lost arbitration has to take it back.
  buzzRevokedAt = 0,
}) {
  const [visibleWords, setVisibleWords] = useState([]);
  const [allWordsShown, setAllWordsShown] = useState(false);
  const [visibleChoices, setVisibleChoices] = useState(null);
  const [buzzing, setBuzzing] = useState(false);
  const [buzzedEarly, setBuzzedEarly] = useState(false);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [answerResult, setAnswerResult] = useState(null);
  const [buzzTimeLeft, setBuzzTimeLeft] = useState(null);
  const [answerTimeLeft, setAnswerTimeLeft] = useState(null);
  const [dead, setDead] = useState(false);
  const [paused, setPaused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [answeredQKey, setAnsweredQKey] = useState(null);
  // Frozen snapshot of the question that was actually answered/revealed.
  // The live `question` prop changes instantly on Next, but the result/answer
  // block may still be mid-exit-animation; rendering from this frozen snapshot
  // guarantees the NEW question's answer can never flash in the old block.
  const [answeredQuestion, setAnsweredQuestion] = useState(null);

  // Refs to avoid stale closures in intervals/timers
  const pausedRef = useRef(false);
  const wordIntervalRef = useRef(null);
  const inputRef = useRef(null);
  const wordIdxRef = useRef(0);
  const allWordsShownRef = useRef(false);
  const deadRef = useRef(false);
  const buzzEnabledRef = useRef(true);
  const externalBuzzedRef = useRef(false);
  // Keep latest values accessible inside interval without re-creating it
  // Identity of the question being read RIGHT NOW. Keyed on its position in the
  // queue, not on `number`/`type`: a bonus carries the same number as the tossup
  // it follows, and as a boss-up it carries the same type too — so a
  // number+type key silently treated the second half of every pair as "still
  // the same question" and never reset the reader. Marathon can draw the same
  // number and type twice in a row from different packets, with the same
  // result. The position is the only thing guaranteed to change on every read.
  const questionKey = `${questionIndex}:${question?.number ?? ''}:${question?.type ?? ''}`;
  const questionKeyRef = useRef(questionKey);
  const questionRef = useRef(question);
  const settingsRef = useRef(settings);
  useEffect(() => { questionKeyRef.current = questionKey; }, [questionKey]);
  useEffect(() => { questionRef.current = question; }, [question]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { allWordsShownRef.current = allWordsShown; }, [allWordsShown]);
  useEffect(() => { deadRef.current = dead; }, [dead]);
  useEffect(() => { buzzEnabledRef.current = buzzEnabled; }, [buzzEnabled]);
  useEffect(() => { externalBuzzedRef.current = externalBuzzed; }, [externalBuzzed]);
  const resolvedRef = useRef(false);
  useEffect(() => { resolvedRef.current = resolved; }, [resolved]);
  const buzzingRef = useRef(false);
  useEffect(() => { buzzingRef.current = buzzing; }, [buzzing]);
  const readingStartedAtRef = useRef(null);
  useEffect(() => { readingStartedAtRef.current = readingStartedAt; }, [readingStartedAt]);
  const wordByWordRef = useRef(true);
  useEffect(() => { wordByWordRef.current = wordByWord; }, [wordByWord]);
  const canAdvanceRef = useRef(true);
  useEffect(() => { canAdvanceRef.current = canAdvance; }, [canAdvance]);

  // Static text instead of a read: a display-mode choice, or a bonus belonging
  // to another team.
  const showsStatically = settings?.display_mode === 'full' || (multiplayer && !wordByWord);

  const isFullMode = settings?.display_mode === 'full';
  const isMC = question?.format === 'Multiple Choice';
  const isBonus = question?.type === 'BONUS';
  // A boss-up is a bonus played as a tossup — read from the first word, open to
  // everyone, but with a longer window to buzz than a real tossup.
  const isBossUp = !!question?.boss_up;
  const isTimed = settings?.timed !== false;
  const baseBuzzTime = settings?.buzz_time || 5;
  const buzzTime = isBonus
    ? baseBuzzTime + 15
    : baseBuzzTime + (isBossUp ? BOSS_UP_EXTRA_SECONDS : 0);

  const clearWordInterval = () => clearInterval(wordIntervalRef.current);

  // ── Word-by-word reading ───────────────────────────────────────────────────
  // Stable: no changing deps — reads question/settings from refs
  const runWordByWord = useCallback((startCount) => {
    const q = questionRef.current;
    const cfg = settingsRef.current;
    const wpm = cfg?.wpm || 250;
    const msPerWord = (60 / wpm) * 1000;
    const words = q?.question_text?.split(' ') || [];
    const mc = q?.format === 'Multiple Choice';

    const choiceTokens = [];
    if (mc && q?.choices) {
      for (const letter of ['W', 'X', 'Y', 'Z']) {
        const text = q.choices[letter];
        if (text) {
          choiceTokens.push(`__CHOICE_${letter}__`);
          text.split(' ').forEach(w => choiceTokens.push(`__CHOICE_${letter}_WORD__${w}`));
        }
      }
    }
    const allTokens = [...words, ...choiceTokens];

    let idx = startCount;
    wordIdxRef.current = idx;
    clearInterval(wordIntervalRef.current);
    wordIntervalRef.current = setInterval(() => {
      if (pausedRef.current) return;
      idx++;
      wordIdxRef.current = idx;
      const shownTokens = allTokens.slice(0, idx);
      const qWords = shownTokens.filter(t => !t.startsWith('__CHOICE_'));
      const shownChoices = {};
      shownTokens.forEach(t => {
        const m = t.match(/^__CHOICE_([WXYZ])_WORD__(.+)$/);
        if (m) {
          shownChoices[m[1]] = (shownChoices[m[1]] ? shownChoices[m[1]] + ' ' : '') + m[2];
        }
      });
      setVisibleWords(qWords);
      setVisibleChoices(Object.keys(shownChoices).length > 0 ? shownChoices : null);

      if (idx >= allTokens.length) {
        clearInterval(wordIntervalRef.current);
        setAllWordsShown(true);
      }
    }, msPerWord);

    // Only start TTS on a fresh read (not when resuming after a buzz)
    if (startCount === 0 && cfg?.read_aloud) {
      window.speechSynthesis?.cancel();
      let ttsText = q.question_text || '';
      if (mc && q?.choices) {
        for (const letter of ['W', 'X', 'Y', 'Z']) {
          if (q.choices[letter]) ttsText += `. ${letter}: ${q.choices[letter]}`;
        }
      }
      const utt = new SpeechSynthesisUtterance(ttsText);
      utt.rate = wpm / 200;
      window.speechSynthesis.speak(utt);
    }
  }, []); // stable — reads from refs

  const startWordByWord = useCallback(() => runWordByWord(0), [runWordByWord]);

  // ── Reset when question changes ────────────────────────────────────────────
  useEffect(() => {
    clearInterval(wordIntervalRef.current);
    window.speechSynthesis?.cancel();

    setVisibleWords([]);
    setVisibleChoices(null);
    setAllWordsShown(false);
    setBuzzing(false);
    setBuzzedEarly(false);
    setSelectedChoice(null);
    setTypedAnswer('');
    setAnswerResult(null);
    setBuzzTimeLeft(null);
    setAnswerTimeLeft(null);
    setDead(false);
    setPaused(false);
    pausedRef.current = false;
    setRevealed(false);
    setAnsweredQKey(null);
    setAnsweredQuestion(null);
    wordIdxRef.current = 0;
    deadReportedRef.current = false;

    // A bonus used to be dumped out whole to everyone. It is now read like a
    // tossup — but only to the team it belongs to, since they are the only ones
    // who may answer it; the rest of the room still gets the static text.
    if (settingsRef.current?.display_mode === 'full' || (multiplayer && !wordByWordRef.current)) {
      setAllWordsShown(true);
    } else if (!externalBuzzedRef.current && !resolvedRef.current) {
      startWordByWord();
    }
    // questionKey, not number/type — see its definition. `question` itself is a
    // fresh object every render (marathon derives it, boss-ups rewrite it), so
    // it cannot be the dependency either. `wordByWord` is in here because it
    // decides which of the two branches above runs, and a bonus's ownership
    // lands in the same frame as the question itself.
  }, [questionKey, startWordByWord, multiplayer, wordByWord]);

  // ── Sync: fast-forward the visible word position to where every client
  // should be, given the server-stamped reading start. ───────────────────────
  //
  // `elapsed` is measured on the SERVER's clock (serverNow), not this machine's:
  // reading_started_at comes from the server, so subtracting a local Date.now()
  // would fold this browser's clock error straight into the word position —
  // seconds of skew is common, which is many words at 250 WPM.
  const syncToTimestamp = useCallback(() => {
    const ts = readingStartedAtRef.current;
    const cfg = settingsRef.current;
    if (!ts || cfg?.display_mode === 'full') return;
    const q = questionRef.current;
    if (!q) return;
    // A bonus is only read to the team it belongs to; nobody else has a
    // position to keep in step.
    if (q.type === 'BONUS' && !wordByWordRef.current) return;

    // The reading is FROZEN — someone is answering, the host has paused, or the
    // question is over. Without this the drift correction below fought the
    // freeze and won: two seconds after a buzz it fast-forwarded to "where the
    // clock says we should be" and restarted the interval, so the question
    // carried on reading itself out from under the player who had buzzed.
    //
    // Nothing is lost by skipping: `reading_started_at` is pushed forward by
    // the frozen interval when the question reopens (server/match.js), so the
    // next sync lands on the word it stopped on.
    if (
      buzzingRef.current ||
      externalBuzzedRef.current ||
      resolvedRef.current ||
      answerResultRef.current ||
      deadRef.current ||
      pausedRef.current
    ) return;

    const wpm = cfg?.wpm || 250;
    const msPerWord = (60 / wpm) * 1000;
    const elapsed = serverNow() - ts;
    if (elapsed < 0) return;
    const targetIdx = Math.min(
      Math.floor(elapsed / msPerWord),
      (q.question_text?.split(' ')?.length || 0)
    );
    if (targetIdx > wordIdxRef.current && !allWordsShownRef.current) {
      wordIdxRef.current = targetIdx;
      runWordByWord(targetIdx);
    }
  }, [runWordByWord]);

  // ── After all words shown: start buzz countdown ────────────────────────────
  useEffect(() => {
    if (externalBuzzed) { setBuzzTimeLeft(null); return; } // pause tossup timer while someone else buzzes
    if (!allWordsShown || buzzing || answerResult || dead || resolved || !isTimed) return;
    setBuzzTimeLeft(buzzTime); // (re)set to the full window when it reopens
  }, [allWordsShown, resolved, externalBuzzed]);  

  // ── Submit answer (defined early so countdowns can reference it) ──────────
  const answerResultRef = useRef(null);
  const buzzedEarlyRef = useRef(false);
  useEffect(() => { answerResultRef.current = answerResult; }, [answerResult]);
  useEffect(() => { buzzedEarlyRef.current = buzzedEarly; }, [buzzedEarly]);
  // Held in a ref so the countdown timers can report without listing a prop
  // that changes identity on every parent render as a dependency — re-running
  // those effects would restart the one-second tick.
  const onAnswerRef = useRef(onAnswer);
  useEffect(() => { onAnswerRef.current = onAnswer; }, [onAnswer]);
  const deadReportedRef = useRef(false);

  // ── Multiplayer: freeze reading while another player is answering; resume from
  // the paused position only when the question reopens (initial buzzer was wrong).
  // Also pause for the buzzer themselves (don't reread from start while buzzing). ──
  useEffect(() => {
    if (externalBuzzed || resolvedRef.current) {
      clearInterval(wordIntervalRef.current);
      window.speechSynthesis?.cancel();
    } else if (
      !buzzingRef.current &&
      !allWordsShownRef.current &&
      !answerResultRef.current &&
      !deadRef.current &&
      !pausedRef.current &&
      settingsRef.current?.display_mode !== 'full'
    ) {
      // Resume reading from where it paused (after an incorrect interrupt by another team)
      runWordByWord(wordIdxRef.current);
    }
  }, [externalBuzzed, resolved, runWordByWord]);

  // ── Periodic sync: correct drift by fast-forwarding to the server timestamp ──
  useEffect(() => {
    if (!multiplayer || !readingStartedAt) return;
    syncToTimestamp();
    const interval = setInterval(syncToTimestamp, 2000);
    return () => clearInterval(interval);
  }, [multiplayer, readingStartedAt, syncToTimestamp]);

  // ── The question is over: show all of it ───────────────────────────────────
  // Someone got it (possibly on an interrupt, mid-sentence), or it died. There
  // is no longer anything to withhold, and leaving the text frozen half-read
  // meant the room never saw the rest of the question it had just played.
  useEffect(() => {
    if (!multiplayer || !resolved) return;
    clearInterval(wordIntervalRef.current);
    window.speechSynthesis?.cancel();
    setAllWordsShown(true);
  }, [multiplayer, resolved]);

  // ── Host pause: freeze/resume for the whole room ──────────────────────────
  // Driven by the server timestamp, not by a local toggle, so every screen
  // stops on the same word and the buzzer is shut for everyone at once.
  const sawPauseRef = useRef(false);
  useEffect(() => {
    if (!multiplayer) return;
    const isPaused = !!externalPausedAt;
    // The reader is remounted for every question, so the first run of this
    // effect is not a pause change — resuming there would restart a read the
    // question-change effect has just started.
    if (!sawPauseRef.current && !isPaused) { sawPauseRef.current = true; return; }
    sawPauseRef.current = true;
    pausedRef.current = isPaused;
    setPaused(isPaused);
    if (isPaused) {
      clearInterval(wordIntervalRef.current);
      window.speechSynthesis?.cancel();
      return;
    }
    // Resuming picks up from the word it stopped on; the server has already
    // pushed `reading_started_at` forward by the paused interval, so the drift
    // sync agrees rather than yanking everyone ahead.
    if (
      !allWordsShownRef.current && !buzzingRef.current && !externalBuzzedRef.current &&
      !resolvedRef.current && !answerResultRef.current && !deadRef.current &&
      settingsRef.current?.display_mode !== 'full' &&
      (questionRef.current?.type !== 'BONUS' || wordByWordRef.current)
    ) {
      runWordByWord(wordIdxRef.current);
    }
  }, [multiplayer, externalPausedAt, runWordByWord]);

  // ── Buzz revoked: another player won the arbitration ──────────────────────
  // Roll the optimistic local buzz back and rejoin the reading where the rest
  // of the room is (the lockout overlay takes over from here).
  useEffect(() => {
    if (!buzzRevokedAt) return;
    if (answerResultRef.current) return; // already answered — nothing to take back
    buzzingRef.current = false;
    buzzedEarlyRef.current = false;
    setBuzzing(false);
    setBuzzedEarly(false);
    setAnswerTimeLeft(null);
    setTypedAnswer('');
    setSelectedChoice(null);
    syncToTimestamp();
  }, [buzzRevokedAt, syncToTimestamp]);

  const doSubmitAnswer = useCallback((answer) => {
    if (answerResultRef.current) return;
    clearInterval(wordIntervalRef.current);
    setAnswerTimeLeft(null);

    const q = questionRef.current;
    const early = buzzedEarlyRef.current;

    // What the player submitted travels with the result: the review screens
    // show it back to them, and without it a wrong answer is indistinguishable
    // from never having answered at all.
    if (answer === null) {
      answerResultRef.current = 'timeout';
      setAnswerResult('timeout');
      setAnsweredQKey(questionKeyRef.current);
      setAnsweredQuestion(q);
      onAnswer({
        result: 'timeout', type: q.type, interrupted: early,
        submitted_answer: null, submitted_choice: null,
        question_format: q?.format || '',
      });
      setRevealed(true);
      return;
    }

    const mc = q?.format === 'Multiple Choice';
    const correctLetter = q.answer?.toUpperCase().replace(/^([WXYZ])[).\s].*/, '$1').trim();
    const isCorrect = mc
      ? checkMCAnswer(answer, correctLetter, q.choices)
      : fuzzyMatch(answer, q.answer, q.answer_alternates, q.question_text);

    const submission = {
      submitted_answer: answer,
      submitted_choice: mc ? resolveChoiceLetter(answer, q.choices) : null,
      question_format: q?.format || '',
    };

    if (isCorrect) {
      answerResultRef.current = 'correct';
      setAnswerResult('correct');
      setAnsweredQKey(questionKeyRef.current);
      setAnsweredQuestion(q);
      onAnswer({ result: 'correct', type: q.type, interrupted: early, ...submission });
    } else {
      const resultKey = (early && q.type === 'TOSSUP') ? 'interrupt_wrong' : 'wrong';
      answerResultRef.current = resultKey;
      setAnswerResult(resultKey);
      setAnsweredQKey(questionKeyRef.current);
      setAnsweredQuestion(q);
      onAnswer({ result: resultKey, type: q.type, interrupted: early, ...submission });
    }
    setRevealed(true);
  }, [onAnswer]);

  // ── Buzz countdown tick ────────────────────────────────────────────────────
  useEffect(() => {
    if (buzzTimeLeft === null || buzzing || answerResult || dead || paused || resolved || externalBuzzed) return;
    if (buzzTimeLeft <= 0) {
      const q = questionRef.current;
      // Report the expiry exactly once per question: `dead` is set in the same
      // pass, so without this a re-entrant run (React's development double
      // invoke) could log the question twice.
      if (deadReportedRef.current) return;
      deadReportedRef.current = true;
      setDead(true);
      setAnsweredQKey(questionKeyRef.current);
      // Freeze the question the answer belongs to (solo reveals it immediately).
      setAnsweredQuestion(q);
      setBuzzTimeLeft(null);
      // Bonuses need this too, or an unanswered bonus never resolves and the
      // match can't advance (the session handler decides what "dead" means).
      if (multiplayer) onDead?.();
      // Solo: record the question as unanswered rather than dropping it. It
      // scores nothing either way, but a question the clock ran out on has to
      // appear in the review — otherwise it silently vanishes from the game.
      else onAnswerRef.current?.({
        result: 'timeout', type: q?.type, interrupted: false,
        submitted_answer: null, submitted_choice: null,
        question_format: q?.format || '',
      });
      return;
    }
    const t = setTimeout(() => setBuzzTimeLeft(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [buzzTimeLeft, buzzing, answerResult, dead, paused, resolved, externalBuzzed, multiplayer, onDead]);

  // ── Answer grace period countdown ─────────────────────────────────────────
  useEffect(() => {
    // A paused match must not tick down the answer clock — the host stopped the
    // room, and timing out the player holding the buzz while it is stopped
    // scores a neg against them for the pause.
    if (answerTimeLeft === null || answerResult || paused) return;
    if (answerTimeLeft <= 0) { doSubmitAnswer(null); return; }
    const t = setTimeout(() => setAnswerTimeLeft(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [answerTimeLeft, answerResult, paused, doSubmitAnswer]);

  // ── Core actions (ref-based to avoid stale closures) ─────────────────────
  const stateRef = useRef({});
  stateRef.current = {
    buzzing, answerResult, dead, externalBuzzed, allWordsShown, visibleWords,
    buzzedEarly, buzzEnabled, paused, multiplayer,
  };

  const handleBuzzFn = useCallback(() => {
    // Stamp the buzz before anything else runs: this instant (on the server's
    // clock) is what the server arbitrates on, so every millisecond of work
    // done before reading it is a millisecond of handicap for this player.
    const buzzedAt = serverNow();
    const s = stateRef.current;
    const q = questionRef.current;
    const cfg = settingsRef.current;
    if (s.answerResult || s.buzzing || s.dead || s.externalBuzzed || !s.buzzEnabled) return;
    // A paused match takes no buzzes — the server rejects them anyway, and an
    // optimistic local buzz here would open an answer box that then vanished.
    if (s.paused) return;
    if (q?.type === 'BONUS' && !s.allWordsShown) return;
    if (cfg?.display_mode !== 'full' && s.visibleWords.length === 0) return;

    clearInterval(wordIntervalRef.current);
    window.speechSynthesis?.cancel();
    setBuzzTimeLeft(null);

    const interrupted = !s.allWordsShown && q?.type !== 'BONUS';
    setBuzzedEarly(interrupted);
    setBuzzing(true);
    setAnswerTimeLeft(ANSWER_GRACE);
    onBuzz?.(buzzedAt);

    if (q?.format !== 'Multiple Choice') {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [onBuzz]);

  const handlePause = useCallback(() => {
    // In a room the pause belongs to the whole match: hand it to the server and
    // let the frame that comes back stop every screen, this one included.
    // Toggling locally would freeze one player's words while the rest read on.
    if (multiplayer) { onPause?.(); return; }
    if (pausedRef.current) {
      pausedRef.current = false;
      setPaused(false);
      if (!stateRef.current.allWordsShown && settingsRef.current?.display_mode !== 'full') {
        startWordByWord();
      }
    } else {
      pausedRef.current = true;
      setPaused(true);
      clearInterval(wordIntervalRef.current);
      window.speechSynthesis?.cancel();
    }
  }, [startWordByWord, multiplayer, onPause]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
      const s = stateRef.current;

      if (e.code === 'Space' && !inInput && !s.buzzing) {
        e.preventDefault();
        handleBuzzFn();
        return;
      }
      if ((e.key === 'p' || e.key === 'P') && !inInput && onPause) {
        e.preventDefault();
        handlePause();
        return;
      }
      if ((e.key === 'q' || e.key === 'Q') && !inInput) {
        e.preventDefault();
        onQuit?.();
        return;
      }
      // Next. Solo goes on this player's own result; in a room it goes on
      // whether the match rules let THIS player move it on — the winning team
      // after a tossup, anyone after a bonus or a dead question. `onNext` is
      // only supplied when they may, so the shortcut and the button agree.
      const mayAdvance = s.multiplayer ? canAdvanceRef.current : (s.answerResult || s.dead);
      if ((e.key === 'n' || e.key === 'N') && !inInput && mayAdvance) {
        e.preventDefault();
        onNext?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleBuzzFn, handlePause, onPause, onQuit, onNext]); // stable refs; stateRef.current is always fresh

  // Answering is open either because this player holds the buzz, or because the
  // question is their team's bonus (no buzz involved).
  const answering = buzzing || openAnswer;

  const handleMCChoice = (letter) => {
    if (!answering || answerResultRef.current) return;
    setSelectedChoice(letter);
    doSubmitAnswer(letter);
  };

  const handleTypedSubmit = (e) => {
    e?.preventDefault();
    if (!answering || !typedAnswer.trim() || answerResultRef.current) return;
    doSubmitAnswer(typedAnswer.trim());
  };

  const words = question?.question_text?.split(' ') || [];
  const showFullText = isFullMode || allWordsShown;
  const displayWords = showFullText ? words : visibleWords;
  const displayChoices = showFullText ? question?.choices : visibleChoices;

  // Guard: only show result/dead/next UI for the question that was actually answered.
  // Prevents the answer from flashing when advancing to a new question.
  const resultForCurrent = answeredQKey === questionKey;
  const showResult = !multiplayer && answerResult && revealed && resultForCurrent;
  const showDead = !multiplayer && dead && resultForCurrent;
  // Hard gate for any answer reveal (text + MC correct-letter highlight).
  // Requires a frozen answered snapshot AND key match AND revealed flag.
  const shouldShowAnswer = !multiplayer && !!answerResult && revealed && resultForCurrent && !!answeredQuestion;
  // Dead with nobody having answered: the answer is shown straight away rather
  // than behind a reveal step — the question is over, there is nothing left to
  // protect. Same frozen-snapshot gate, so the next question's answer can never
  // flash here during the transition.
  const showDeadAnswer = !multiplayer && dead && !answerResult && resultForCurrent && !!answeredQuestion;
  const deadQuestion = answeredQuestion;

  const pointLabel = (res) => {
    if (res === 'wrong') return '0 pts';
    if (res !== 'correct' && res !== 'interrupt_wrong') return '';
    const pts = pointsFor(res, answeredQuestion?.type, {
      interrupted: buzzedEarly,
      powers: !!settings?.powers,
    });
    return `${pts > 0 ? '+' : pts < 0 ? '−' : ''}${Math.abs(pts)} pts`;
  };
  const isPower = !!settings?.powers && buzzedEarly && answerResult === 'correct'
    && answeredQuestion?.type === 'TOSSUP';

  return (
    <div className="space-y-4">
      {/* ── Question header ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
          <Hash className="w-3.5 h-3.5" />{positionLabel ?? questionIndex + 1}
          <span className="text-muted-foreground/50">
            /{Number.isFinite(totalPositions ?? totalQuestions) ? (totalPositions ?? totalQuestions) : '∞'}
          </span>
        </span>
        <Badge variant={isBonus ? 'secondary' : 'default'} className="text-xs">
          {isBossUp ? 'BOSS-UP' : question?.type}
        </Badge>
        <Badge variant="outline" className={cn('text-xs', SUBJECT_COLORS[question?.subject] || '')}>
          {question?.subject}
        </Badge>
        <Badge variant="outline" className="text-xs">{question?.format}</Badge>
        {isBonusFor && (
          <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/30 text-xs">
            Bonus for {isBonusFor}
          </Badge>
        )}
        {showDead && (
          <Badge variant="outline" className="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 border-slate-300 text-xs">
            Dead
          </Badge>
        )}
        {paused && (
          <Badge variant="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 text-xs">
            {multiplayer ? 'Paused by the host' : 'Paused'}
          </Badge>
        )}
        {/* Read to the team it belongs to; everyone else is looking at the same
            text, but static, and cannot answer it. Saying so beats leaving the
            other teams wondering why their buzzer is dead. */}
        {multiplayer && showsStatically && isBonus && (
          <Badge variant="outline" className="text-xs text-muted-foreground">
            Read to {isBonusFor || 'the other team'}
          </Badge>
        )}
      </div>

      {/* ── Question text ── */}
      <div className={cn(
        "rounded-xl border p-5 min-h-[100px] transition-colors",
        dead ? "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700" : "bg-card border-border"
      )}>
        <p className={cn("text-base leading-relaxed", dead && "text-muted-foreground")}>
          {displayWords.map((word, i) => <span key={i}>{word} </span>)}
          {!allWordsShown && !isFullMode && !buzzing && !dead && (
            <span className="inline-block w-1.5 h-4 bg-primary/60 animate-pulse align-middle ml-0.5" />
          )}
        </p>
      </div>

      {/* ── Buzz countdown bar ──
          On a bonus this window IS the answer window: the box is already open,
          so it counts down to the answer, not to a buzz. */}
      {allWordsShown && !buzzing && !answerResult && !dead && isTimed && buzzTimeLeft !== null && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" /> {openAnswer ? 'Time to answer' : 'Time to buzz'}
            </span>
            <span className={cn("font-mono font-semibold", buzzTimeLeft <= 3 && "text-destructive")}>{buzzTimeLeft}s</span>
          </div>
          <Progress value={(buzzTimeLeft / buzzTime) * 100} className="h-1.5" />
        </div>
      )}

      {/* ── MC Choices ── */}
      {isMC && displayChoices && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {['W', 'X', 'Y', 'Z'].map(letter => {
            const choiceText = displayChoices[letter];
            if (!choiceText) return null;
            // Derive the correct letter ONLY from the frozen answered snapshot,
            // and only consider it "revealed" when shouldShowAnswer is true.
            // This prevents the NEXT question's correct choice from flashing
            // during the one-frame stale-state window after Next is pressed.
            const frozenCorrectLetter = answeredQuestion?.answer?.toUpperCase().replace(/^([WXYZ])[).\s].*/, '$1').trim();
            const isCorrectLetter = (shouldShowAnswer || showDeadAnswer) && letter === frozenCorrectLetter;
            const pickedThis = shouldShowAnswer && selectedChoice === letter;
            return (
              <button
                key={letter}
                onClick={() => answering ? handleMCChoice(letter) : handleBuzzFn()}
                disabled={(!!answerResult && resultForCurrent && selectedChoice !== letter && !isCorrectLetter) || dead}
                className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border text-left text-sm transition-all duration-150",
                  !answerResult && !dead && "hover:bg-muted/60 cursor-pointer",
                  answering && !answerResult && "hover:bg-primary/10 hover:border-primary/40",
                  pickedThis && answerResult === 'correct' && "bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300",
                  pickedThis && (answerResult === 'wrong' || answerResult === 'interrupt_wrong') && "bg-destructive/10 border-destructive",
                  isCorrectLetter && selectedChoice !== letter && "bg-emerald-500/10 border-emerald-500/50",
                  "border-border bg-card"
                )}
              >
                <span className="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold flex-shrink-0 bg-muted text-muted-foreground">
                  {letter}
                </span>
                <span>{choiceText}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Typed answer input ── */}
      {answering && !answerResult && (
        <form onSubmit={handleTypedSubmit} className="flex gap-2">
          <Input
            ref={inputRef}
            value={typedAnswer}
            onChange={e => setTypedAnswer(e.target.value)}
            placeholder={isMC
              ? 'Type W, X, Y, or Z — or click above…'
              : openAnswer && openAnswerTeam
                ? 'Type your answer, press Enter to submit for your team…'
                : 'Type your answer…'}
            className="flex-1"
            autoFocus={!isMC}
          />
          <Button type="submit">Submit</Button>
        </form>
      )}
      {/* Every player on the team has one of these open, so say what pressing
          Enter actually does — the first submission is the team's answer. */}
      {openAnswer && !answerResult && openAnswerTeam && (
        <p className="text-xs text-muted-foreground -mt-2">
          <span className="font-medium text-foreground">{openAnswerTeam}</span>&apos;s bonus — confer.
          The first answer anyone on the team submits is the one that counts.
        </p>
      )}

      {/* ── Answer grace timer ── */}
      {buzzing && !answerResult && answerTimeLeft !== null && (
        <div className="flex items-center gap-3">
          <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <Progress value={(answerTimeLeft / ANSWER_GRACE) * 100} className="flex-1 h-2" />
          <span className={cn("text-sm font-mono font-semibold tabular-nums", answerTimeLeft <= 3 && "text-destructive")}>
            {answerTimeLeft}s
          </span>
        </div>
      )}

      {/* ── Buzz / action buttons ──
          Not on a bonus this player may answer: there is no buzz to press. */}
      {!answering && !answerResult && !dead && !resolved && (
        <div className="flex gap-2">
          <Button
            size="lg"
            className="flex-1 font-semibold"
            onClick={handleBuzzFn}
            disabled={externalBuzzed || !buzzEnabled || paused || (isBonus && !allWordsShown)}
          >
            <Zap className="w-4 h-4 mr-2" />
            {paused
              ? 'Paused'
              : !allWordsShown && !isBonus ? 'Interrupt (Space)' : 'Buzz In (Space)'}
          </Button>
          {onPause && (
            <Button variant="outline" size="lg" onClick={handlePause} title={paused ? 'Resume (P)' : 'Pause (P)'}>
              <Pause className="w-4 h-4" />
            </Button>
          )}
          {onQuit && (
            <Button variant="ghost" size="lg" onClick={onQuit} title="Quit (Q)" className="text-muted-foreground hover:text-destructive">
              <LogOut className="w-4 h-4" />
            </Button>
          )}
        </div>
      )}

      {/* ── Pause/quit while answering ── */}
      {answering && !answerResult && (onPause || onQuit) && (
        <div className="flex gap-2 justify-end">
          {onPause && (
            <Button variant="outline" size="sm" onClick={handlePause} title={paused ? 'Resume (P)' : 'Pause (P)'}>
              <Pause className="w-3.5 h-3.5 mr-1" />{paused ? 'Resume' : 'Pause'}
            </Button>
          )}
          {onQuit && (
            <Button variant="ghost" size="sm" onClick={onQuit} title="Quit (Q)" className="text-muted-foreground hover:text-destructive">
              <LogOut className="w-3.5 h-3.5 mr-1" /> Quit
            </Button>
          )}
        </div>
      )}

      {/* ── Dead question ── */}
      {showDead && !answerResult && (
        <div className="rounded-lg bg-slate-100 dark:bg-slate-800 px-4 py-3 text-sm text-slate-500 dark:text-slate-400 text-center">
          Question dead — no one buzzed in time
        </div>
      )}

      {/* ── Answer zone ──
          Rendered only once the question is over for this player: answered,
          timed out, or dead. While it is live there is nothing here at all —
          no placeholder to click, and nothing on screen that could leak the
          answer to someone still being read the question. */}
      {(shouldShowAnswer || showDeadAnswer) && (
      <div className="relative rounded-xl border bg-card min-h-[64px] overflow-hidden">
        <AnimatePresence>
          {shouldShowAnswer && (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={cn(
                "p-4 border-0 rounded-xl",
                answerResult === 'correct' && "bg-emerald-500/10",
                (answerResult === 'wrong' || answerResult === 'interrupt_wrong') && "bg-destructive/10",
                answerResult === 'timeout' && "bg-muted",
              )}
            >
              <div className="flex items-start gap-3">
                {answerResult === 'correct'
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
                  : <XCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                }
                <div>
                  <p className="font-semibold text-sm">
                    {answerResult === 'correct' && `${isPower ? 'Power! ' : 'Correct! '}${pointLabel('correct')}`}
                    {answerResult === 'wrong' && `Incorrect. ${pointLabel('wrong')}`}
                    {answerResult === 'interrupt_wrong' && `Interrupt penalty! ${pointLabel('interrupt_wrong')}`}
                    {answerResult === 'timeout' && "Time's up! 0 pts"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Answer: <span className="font-medium text-foreground">{answeredQuestion?.answer}</span>
                    {answeredQuestion?.answer_alternates?.length > 0 && (
                      <span className="text-xs"> (also: {answeredQuestion.answer_alternates.join(', ')})</span>
                    )}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
          {showDeadAnswer && (
            <motion.div
              key="dead"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-4 rounded-xl border-0 bg-slate-100 dark:bg-slate-800/60"
            >
              <p className="text-sm text-muted-foreground">
                Answer: <span className="font-medium text-foreground">{deadQuestion?.answer}</span>
                {deadQuestion?.answer_alternates?.length > 0 && (
                  <span className="text-xs"> (also: {deadQuestion.answer_alternates.join(', ')})</span>
                )}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      )}

      {/* ── Next / keyboard hints ── */}
      {(showResult || showDead) && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onNext} className="flex-1">
              {questionIndex + 1 < totalQuestions ? 'Next Question →' : 'See Results'}
              <span className="ml-2 text-xs text-muted-foreground opacity-60">[N]</span>
            </Button>
            {onQuit && (
              <Button variant="ghost" onClick={onQuit} className="text-muted-foreground hover:text-destructive" title="Quit (Q)">
                <LogOut className="w-4 h-4" />
              </Button>
            )}
          </div>
          <div className="flex gap-2 justify-center text-xs text-muted-foreground/60">
            {onPause && <span>[P] {paused ? 'Resume' : 'Pause'}</span>}
            {onQuit && <span>[Q] Quit</span>}
          </div>
        </div>
      )}
    </div>
  );
}