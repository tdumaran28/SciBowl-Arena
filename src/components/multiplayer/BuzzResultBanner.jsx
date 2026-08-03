import { CheckCircle2, XCircle, Skull } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared result banner shown to ALL players, directly below the question.
// Format: "Correct [Player | Team] +4/+10" · "Incorrect [Player | Team] 0" ·
// "Incorrect, Neg [Player | Team] -4". Also surfaces a dead-question line.
export default function BuzzResultBanner({ buzzState, dead, answer }) {
  if (!buzzState) return null;
  const { result, result_player, result_team, result_points, result_interrupted } = buzzState;
  const hasResult = !!result;
  const showDead = dead && result !== 'correct';
  if (!hasResult && !showDead) return null;

  const label = result_team ? `${result_player || ''} | ${result_team}` : (result_player || '');

  if (!hasResult && showDead) {
    return (
      <div className="rounded-xl border border-slate-300 bg-slate-100 dark:bg-slate-800 dark:border-slate-700 p-4 flex items-start gap-3">
        <Skull className="w-5 h-5 text-slate-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold text-sm text-slate-600 dark:text-slate-300">Question is dead</p>
          {answer && <p className="text-sm text-muted-foreground">Answer: <span className="font-medium text-foreground">{answer}</span></p>}
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
  const headline = isCorrect ? 'Correct' : isNeg ? 'Incorrect, Neg' : 'Incorrect';
  const pts = result_points ?? 0;
  const ptsStr = (pts > 0 ? '+' : '') + pts;

  return (
    <div className="space-y-2">
      <div className={cn('rounded-xl border p-4 flex items-start gap-3', toneBox)}>
        <Icon className={cn('w-5 h-5 flex-shrink-0 mt-0.5', iconColor)} />
        <div>
          <p className={cn('font-semibold text-sm', toneText)}>{headline} [{label}] {ptsStr}</p>
          {answer && <p className="text-sm text-muted-foreground">Answer: <span className="font-medium text-foreground">{answer}</span></p>}
        </div>
      </div>
      {showDead && (
        <div className="rounded-xl border border-slate-300 bg-slate-100 dark:bg-slate-800 dark:border-slate-700 p-3 flex items-center gap-2">
          <Skull className="w-4 h-4 text-slate-500" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Question is dead — no team answered correctly</p>
        </div>
      )}
    </div>
  );
}