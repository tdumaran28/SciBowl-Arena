import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SUBJECT_COLORS, pointsFor, submittedText } from '@/utils/parseRound';
import { CheckCircle2, XCircle, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

// Read back a question that has already been played, from the in-game side
// panel. Only ever opened for questions that are done — reopening a live
// question here would hand the reader the answer mid-round.

const RESULT_META = {
  correct: { icon: CheckCircle2, label: 'Correct', tone: 'text-emerald-600 dark:text-emerald-400' },
  interrupt_wrong: { icon: Zap, label: 'Wrong (interrupt)', tone: 'text-destructive' },
  wrong: { icon: XCircle, label: 'Wrong', tone: 'text-destructive' },
  timeout: { icon: Clock, label: 'No answer', tone: 'text-muted-foreground' },
  neg: { icon: Zap, label: 'Neg', tone: 'text-destructive' },
  dead: { icon: Clock, label: 'Dead — no answer', tone: 'text-muted-foreground' },
};

/**
 * @param entry   Optional result/log record for the question — shows what was
 *                submitted, whether it was right, and the points. Omit for a
 *                plain read-back.
 * @param powers  Power scoring was enabled for this game (affects the points
 *                shown for a correct interrupt).
 * @param questionLabel  Pair-numbered position ("1.B"). Preferred over
 *                questionNumber, which counts questions rather than pairs.
 */
export default function QuestionReviewDialog({ open, onOpenChange, question, questionNumber, entry = null, powers = false, questionLabel = null }) {
  const meta = entry?.result ? RESULT_META[entry.result] : null;
  const Icon = meta?.icon;
  const isMC = question?.format === 'Multiple Choice';
  const correctLetter = question?.answer?.toUpperCase().replace(/^([WXYZ])[).\s].*/, '$1').trim();
  const submitted = submittedText(entry, question);
  const answeredCorrectly = entry?.result === 'correct';
  const pickedLetter = entry?.submitted_choice || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap text-base">
            {(questionLabel || questionNumber != null) && (
              <span>Question {questionLabel ?? questionNumber}</span>
            )}
            {question?.type && (
              <Badge variant={question.type === 'BONUS' ? 'secondary' : 'default'} className="text-xs">
                {question.boss_up ? 'BOSS-UP' : question.type}
              </Badge>
            )}
            {question?.subject && (
              <Badge variant="outline" className={cn('text-xs', SUBJECT_COLORS[question.subject])}>
                {question.subject}
              </Badge>
            )}
            {question?.question_set && (
              <Badge variant="outline" className="text-xs font-normal">{question.question_set}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {!question ? (
          <p className="text-sm text-muted-foreground py-4">
            This question is no longer available to review.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Question</p>
              <p className="text-sm leading-relaxed">{question.question_text}</p>
            </div>

            {isMC && question.choices && (
              <div className="space-y-1.5">
                {['W', 'X', 'Y', 'Z'].map(letter => question.choices[letter] && (
                  <div
                    key={letter}
                    className={cn(
                      'flex gap-2 text-sm rounded-lg border px-3 py-2',
                      letter === correctLetter
                        ? 'border-emerald-500/40 bg-emerald-500/10'
                        : letter === pickedLetter
                          ? 'border-destructive/40 bg-destructive/10'
                          : 'border-border',
                    )}
                  >
                    <span className="font-bold text-muted-foreground">{letter})</span>
                    <span>{question.choices[letter]}</span>
                    {letter === correctLetter && (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 ml-auto flex-shrink-0" />
                    )}
                    {letter === pickedLetter && letter !== correctLetter && (
                      <XCircle className="w-4 h-4 text-destructive ml-auto flex-shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* What was submitted. A wrong answer and no answer at all score the
                same, so the review has to distinguish them explicitly. */}
            {entry && (
              <div
                className={cn(
                  'rounded-lg border p-3',
                  submitted
                    ? answeredCorrectly
                      ? 'border-emerald-500/30 bg-emerald-500/5'
                      : 'border-destructive/30 bg-destructive/5'
                    : 'border-border bg-muted/40',
                )}
              >
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  {entry.player ? `${entry.player}'s answer` : 'Your answer'}
                </p>
                {submitted ? (
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    {answeredCorrectly
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      : <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />}
                    <span className={answeredCorrectly
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-destructive'}>
                      {submitted}
                    </span>
                    <span className={cn(
                      'text-xs font-normal',
                      answeredCorrectly ? 'text-emerald-700/70 dark:text-emerald-400/70' : 'text-destructive/70',
                    )}>
                      · {answeredCorrectly ? 'correct' : 'incorrect'}
                    </span>
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4 flex-shrink-0" />
                    No answer given
                  </p>
                )}
              </div>
            )}

            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-xs font-medium text-muted-foreground mb-1">Answer</p>
              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{question.answer}</p>
              {question.answer_alternates?.length > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Also accepted: {question.answer_alternates.join(', ')}
                </p>
              )}
            </div>

            {entry && (
              <div className="flex items-center gap-2 text-sm border-t border-border pt-3">
                {Icon && <Icon className={cn('w-4 h-4', meta.tone)} />}
                <span className={cn('font-medium', meta?.tone)}>{meta?.label || entry.result}</span>
                {entry.player && (
                  <span className="text-muted-foreground">· {entry.player}{entry.team ? ` (${entry.team})` : ''}</span>
                )}
                <Badge variant="outline" className="ml-auto tabular-nums">
                  {(() => {
                    const pts = entry.points ?? pointsFor(entry.result, entry.type || question.type, {
                      interrupted: entry.interrupted,
                      powers,
                    });
                    return `${pts > 0 ? '+' : ''}${pts} pts`;
                  })()}
                </Badge>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
