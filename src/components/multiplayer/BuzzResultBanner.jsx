import { CheckCircle2, XCircle, Ban } from 'lucide-react';
import { SCORING } from '@/utils/parseRound';
import { cn } from '@/lib/utils';

// Shared result banner shown to ALL players, directly below the question.
// Format: "Correct [Player | Team] +4/+10" · "Incorrect [Player | Team] 0" ·
// "Incorrect, Neg [Player | Team] -4". Also surfaces a dead-question line.
//
// `revealAnswer` gates the correct answer, and it is the whole point of this
// component's ordering: after a wrong answer the question is still live for the
// other teams, so the answer stays hidden and only the result is announced.
// When the question finally ends — someone gets it, or it dies — the answer is
// appended underneath whatever result box is showing.
export default function BuzzResultBanner({ buzzState, dead, answer, wrongLimit = null, revealAnswer = false }) {
  if (!buzzState) return null;
  const { result, result_player, result_team, result_points, result_interrupted } = buzzState;
  const hasResult = !!result;
  const showDead = dead && result !== 'correct';
  if (!hasResult && !showDead) return null;

  const label = result_team ? `${result_player || ''} | ${result_team}` : (result_player || '');
  const answerLine = revealAnswer && answer
    ? (
      <p className="text-sm text-muted-foreground mt-1">
        Answer: <span className="font-medium text-foreground">{answer}</span>
      </p>
    )
    : null;

  // Why it died, so a locked-out room isn't left guessing. A wrong-answer
  // lockout is the one that needs saying — it can fire while players who never
  // buzzed are still waiting for their turn.
  const wrongCount = buzzState.wrong_count || 0;
  const byWrongLimit = wrongLimit != null && wrongCount >= wrongLimit;
  const deadReason = byWrongLimit
    ? `locked after ${wrongCount} incorrect answer${wrongCount === 1 ? '' : 's'}`
    : 'no team answered correctly';

  if (!hasResult && showDead) {
    return (
      <div className="rounded-xl border border-slate-300 bg-slate-100 dark:bg-slate-800 dark:border-slate-700 p-4 flex items-start gap-3">
        <Ban className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm text-slate-600 dark:text-slate-300">
            Question is dead — {deadReason}
          </p>
          {answerLine}
        </div>
      </div>
    );
  }

  const isCorrect = result === 'correct';
  const isNeg = result === 'neg' || result_interrupted;
  const tone = isCorrect ? 'green' : isNeg ? 'red' : 'gray';
  const toneBox = {
    green: 'border-emerald-500/40 bg-emerald-500/10',
    red: 'border-red-500/40 bg-red-500/10',
    gray: 'border-slate-300 bg-slate-100 dark:bg-slate-800 dark:border-slate-700',
  }[tone];
  const toneText = {
    green: 'text-emerald-700 dark:text-emerald-300',
    red: 'text-red-700 dark:text-red-300',
    gray: 'text-slate-600 dark:text-slate-300',
  }[tone];
  const iconColor = { green: 'text-emerald-500', red: 'text-red-500', gray: 'text-slate-500' }[tone];

  const Icon = isCorrect ? CheckCircle2 : XCircle;
  const pts = result_points ?? 0;
  // Correct interrupt scored above the flat tossup value — this room is playing
  // with powers.
  const isPower = isCorrect && result_interrupted && pts > SCORING.TOSSUP_CORRECT;
  const headline = isPower ? 'Power' : isCorrect ? 'Correct' : isNeg ? 'Incorrect, Neg' : 'Incorrect';
  const ptsStr = (pts > 0 ? '+' : '') + pts;

  return (
    <div className="space-y-2">
      <div className={cn('rounded-xl border p-4 flex items-start gap-3', toneBox)}>
        <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', iconColor)} />
        <div>
          <p className={cn('font-semibold text-sm', toneText)}>{headline} [{label}] {ptsStr}</p>
          {/* Still live for the other teams? Then this says so instead of the
              answer, so nobody reads the answer off a rival's miss. */}
          {answerLine || (
            !isCorrect && !dead && (
              <p className="text-sm text-muted-foreground mt-1">
                Question still open — answer hidden until it is won or dead
              </p>
            )
          )}
        </div>
      </div>
      {showDead && (
        <div className="rounded-xl border border-slate-300 bg-slate-100 dark:bg-slate-800 dark:border-slate-700 p-3 flex items-center gap-2">
          <Ban className="w-4 h-4 text-slate-500 flex-shrink-0" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Question is dead — {deadReason}
          </p>
        </div>
      )}
    </div>
  );
}
