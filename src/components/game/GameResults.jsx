import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trophy, RotateCcw, Home, BookOpen, Eye } from 'lucide-react';
import { SUBJECT_COLORS, SCORING, calculateScore, pointsFor, submittedText } from '@/utils/parseRound';
import Link from 'next/link';
import { motion } from 'framer-motion';
import PostGameActions from '@/components/game/PostGameActions';
import QuestionReviewDialog from '@/components/game/QuestionReviewDialog';

export default function GameResults({ results = [], questions = [], onReplay, roundTitle, mode = 'solo', subjectsFilter = [], hideLeaderboard = false, isPartial = false, sessionId = null, powers = false, bossUps = false, positionLabels = null }) {
  const [reviewIndex, setReviewIndex] = useState(null);
  const score = calculateScore(results, { powers });

  const correct = results.filter(r => r.result === 'correct').length;
  const wrong = results.filter(r => r.result === 'wrong' || r.result === 'interrupt_wrong').length;
  const negs = results.filter(r => r.result === 'interrupt_wrong').length;
  const correctInterrupts = results.filter(r => r.result === 'correct' && r.interrupted).length;
  const accuracy = results.length > 0 ? Math.round((correct / results.length) * 100) : 0;

  // Subject breakdown
  const subjectResults = {};
  results.forEach((r, i) => {
    const q = questions[i];
    if (!q) return;
    const s = q.subject || 'General Science';
    if (!subjectResults[s]) subjectResults[s] = { correct: 0, total: 0, points: 0 };
    subjectResults[s].total++;
    if (r.result === 'correct') subjectResults[s].correct++;
    subjectResults[s].points += pointsFor(r.result, r.type, { interrupted: r.interrupted, powers });
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="text-center"
      >
        <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 ${isPartial ? 'bg-muted border-2 border-border' : 'bg-amber-500/15 border-2 border-amber-500/30'}`}>
          <Trophy className={`w-10 h-10 ${isPartial ? 'text-muted-foreground' : 'text-amber-500'}`} />
        </div>
        <h1 className="text-3xl font-bold mb-1">{isPartial ? 'Game Finished' : 'Game Complete!'}</h1>
        {isPartial && <p className="text-sm text-muted-foreground mb-1">Partial results — score not eligible for leaderboard</p>}
        <p className="text-muted-foreground">{roundTitle}</p>
      </motion.div>

      {/* Score card */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-6 text-center">
            <p className="text-6xl font-bold text-primary mb-2">{score}</p>
            <p className="text-muted-foreground">Total Points</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
              <div>
                <p className="text-2xl font-bold text-emerald-500">{correct}</p>
                <p className="text-xs text-muted-foreground">Correct</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-destructive">{wrong}</p>
                <p className="text-xs text-muted-foreground">Wrong</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-500">{negs}</p>
                <p className="text-xs text-muted-foreground">Negs</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-primary">{correctInterrupts}</p>
                <p className="text-xs text-muted-foreground">
                  {powers ? `Powers (+${SCORING.TOSSUP_POWER} ea.)` : 'Power Buzzes'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Subject breakdown */}
      {Object.keys(subjectResults).length > 0 && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" /> Subject Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {Object.entries(subjectResults).map(([subj, stats]) => {
                const pct = Math.round((stats.correct / stats.total) * 100);
                return (
                  <div key={subj} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className={`text-xs flex-shrink-0 ${SUBJECT_COLORS[subj] || ''}`}>
                        {subj}
                      </Badge>
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-destructive'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-20 text-right">{stats.correct}/{stats.total} ({pct}%)</span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-1">
                      <span className={stats.points >= 0 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-destructive font-medium'}>
                        {stats.points >= 0 ? '+' : ''}{stats.points} pts
                      </span>
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Question review */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Question Review</CardTitle>
            <p className="text-xs text-muted-foreground">Click a question to see it in full</p>
          </CardHeader>
          <CardContent className="space-y-2 max-h-80 overflow-y-auto">
            {results.map((r, i) => {
              const q = questions[i];
              if (!q) return null;
              const submitted = submittedText(r, q);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setReviewIndex(i)}
                  className="w-full flex items-start gap-3 py-2 border-b border-border last:border-0 text-left group hover:bg-muted/40 rounded-md px-1 -mx-1 transition-colors"
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-xs font-bold ${
                    r.result === 'correct' ? 'bg-emerald-500/20 text-emerald-600' :
                    r.result === 'interrupt_wrong' ? 'bg-orange-500/20 text-orange-600' :
                    r.result === 'wrong' ? 'bg-destructive/20 text-destructive' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {r.result === 'correct' ? '✓' : r.result === 'timeout' ? '–' : '✗'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">
                      {positionLabels?.[i] && (
                        <span className="text-muted-foreground font-normal tabular-nums">Q{positionLabels[i]} · </span>
                      )}
                      {q.question_text?.slice(0, 80)}…
                    </p>
                    {/* Your answer vs the right one — and, when the clock ran
                        out, that no answer was ever given. */}
                    {submitted ? (
                      <p className="text-xs text-muted-foreground truncate">
                        You said:{' '}
                        <span className={r.result === 'correct'
                          ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                          : 'text-destructive font-medium'}>
                          {submitted}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground/60 italic">No answer given</p>
                    )}
                    <p className="text-xs text-muted-foreground truncate">Answer: <span className="text-foreground">{q.answer}</span></p>
                  </div>
                  <Eye className="w-3.5 h-3.5 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors flex-shrink-0 mt-0.5" />
                  <Badge variant="outline" className="text-xs flex-shrink-0">{q.type}</Badge>
                </button>
              );
            })}
          </CardContent>

          <QuestionReviewDialog
            open={reviewIndex !== null}
            onOpenChange={(v) => !v && setReviewIndex(null)}
            question={reviewIndex !== null ? questions[reviewIndex] : null}
            questionNumber={reviewIndex !== null ? reviewIndex + 1 : null}
            questionLabel={reviewIndex !== null ? positionLabels?.[reviewIndex] : null}
            entry={reviewIndex !== null ? results[reviewIndex] : null}
            powers={powers}
          />
        </Card>
      </motion.div>

      {/* Post-game actions: leaderboard + CSV + notes */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <PostGameActions results={results} questions={questions} roundTitle={roundTitle} score={score} mode={mode} subjectsFilter={subjectsFilter} hideLeaderboard={hideLeaderboard} sessionId={sessionId} powers={powers} bossUps={bossUps} />
      </motion.div>

      {/* Nav actions */}
      <div className="flex gap-3">
        <Link href="/" className="flex-1">
          <Button variant="outline" className="w-full">
            <Home className="w-4 h-4 mr-2" /> Home
          </Button>
        </Link>
        <Button className="flex-1" onClick={onReplay}>
          <RotateCcw className="w-4 h-4 mr-2" /> Play Again
        </Button>
      </div>
    </div>
  );
}