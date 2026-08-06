import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Eye } from 'lucide-react';
import { calculateScore, pointsFor } from '@/utils/parseRound';
import QuestionReviewDialog from '@/components/game/QuestionReviewDialog';

/**
 * @param questions  Index-aligned with `results` (results[i] ↔ questions[i]).
 *                   When supplied, each row opens the question for review —
 *                   these are all already-answered questions, so no live
 *                   answer is exposed.
 * @param powers     Power scoring enabled for this game.
 * @param positionLabels  Pair-numbered labels ("1.T", "1.B"), index-aligned
 *                   with `results`. The caller owns the numbering because only
 *                   it holds the whole question list. Falls back to a running
 *                   count when absent.
 */
export default function ScoreBoard({ results = [], playerName = 'You', compact = false, questions = null, powers = false, positionLabels = null }) {
  const [reviewIndex, setReviewIndex] = useState(null);
  const canReview = Array.isArray(questions) && questions.length > 0;
  const score = calculateScore(results, { powers });

  const correct = results.filter(r => r.result === 'correct').length;
  const wrong = results.filter(r => r.result === 'wrong' || r.result === 'interrupt_wrong').length;
  const total = results.length;
  const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Trophy className="w-4 h-4 text-amber-500" />
          <span className="font-bold text-lg">{score}</span>
          <span className="text-xs text-muted-foreground">pts</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="text-xs text-muted-foreground">
          {correct}✓ {wrong}✗
        </div>
      </div>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          {playerName}'s Score
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-4xl font-bold text-primary mb-4">{score} <span className="text-base font-normal text-muted-foreground">pts</span></div>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-500">{correct}</p>
            <p className="text-xs text-muted-foreground">Correct</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-destructive">{wrong}</p>
            <p className="text-xs text-muted-foreground">Wrong</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{accuracy}%</p>
            <p className="text-xs text-muted-foreground">Accuracy</p>
          </div>
        </div>

        {results.length > 0 && (
          <div className="mt-4 space-y-1 max-h-40 overflow-y-auto">
            {canReview && (
              <p className="text-[10px] text-muted-foreground/70 pb-1">Click a question to review it</p>
            )}
            {results.map((r, i) => {
              const pts = pointsFor(r.result, r.type, { interrupted: r.interrupted, powers });
              const badge = (
                <Badge
                  variant="outline"
                  className={`text-xs w-14 justify-center flex-shrink-0 ${
                    r.result === 'correct' ? 'text-emerald-600 border-emerald-500/40' :
                    r.result === 'interrupt_wrong' ? 'text-destructive border-destructive/40' :
                    'text-muted-foreground'
                  }`}
                >
                  {pts > 0 ? `+${pts}` : pts}
                </Badge>
              );
              // Timed-out questions read as a plain "0" otherwise, which is
              // exactly how a wrong answer reads — call it out.
              const label = (
                <span className="text-muted-foreground">
                  Q{positionLabels?.[i] ?? `${i + 1} · ${r.type}`}
                  {r.result === 'timeout' && <span className="text-muted-foreground/60"> · no answer</span>}
                </span>
              );

              if (!canReview) {
                return (
                  <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                    {badge}{label}
                  </div>
                );
              }
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setReviewIndex(i)}
                  className="w-full flex items-center gap-2 text-xs py-1 px-1 -mx-1 rounded hover:bg-muted/60 transition-colors text-left group"
                >
                  {badge}
                  {label}
                  <Eye className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground ml-auto transition-colors" />
                </button>
              );
            })}
          </div>
        )}
      </CardContent>

      {canReview && (
        <QuestionReviewDialog
          open={reviewIndex !== null}
          onOpenChange={(v) => !v && setReviewIndex(null)}
          question={reviewIndex !== null ? questions[reviewIndex] : null}
          questionNumber={reviewIndex !== null ? reviewIndex + 1 : null}
          questionLabel={reviewIndex !== null ? positionLabels?.[reviewIndex] : null}
          entry={reviewIndex !== null ? results[reviewIndex] : null}
          powers={powers}
        />
      )}
    </Card>
  );
}