import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import GameSettings from '@/components/game/GameSettings';
import QuestionReader from '@/components/game/QuestionReader';
import RoundSelect from '@/components/game/RoundSelect';
import ScoreBoard from '@/components/game/ScoreBoard';
import GameResults from '@/components/game/GameResults';
import GameKindSelect from '@/components/game/GameKindSelect';
import MarathonSetup, { DEFAULT_MARATHON_CONFIG } from '@/components/game/MarathonSetup';
import { buildMarathonPools, marathonQuestionAt, randomSeed } from '@/utils/marathon';
import { calculateScore, applyQuestionRules, asBossUp, pairPositions } from '@/utils/parseRound';
import { BookOpen, Timer, Play } from 'lucide-react';
import { toast } from 'sonner';

const DEFAULT_SETTINGS = {
  read_aloud: false,
  wpm: 250,
  answer_time: 8,
  powers: false,
  boss_ups: false,
  skip_bonuses: false,
  subjects: [],
  question_types: ['TOSSUP', 'BONUS'],
  display_mode: 'word_by_word',
};

export default function SoloPlay() {
  const searchParams = useSearchParams();
  const preselectedRoundId = searchParams.get('roundId');

  const [selectedRoundId, setSelectedRoundId] = useState('');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [gameState, setGameState] = useState('setup'); // 'setup' | 'playing' | 'finished' | 'abandoned'
  const [activeQuestions, setActiveQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState([]);
  const [bonusFor, setBonusFor] = useState(null);
  const [waitingForBonus, setWaitingForBonus] = useState(false);
  const [paused, setPaused] = useState(false);
  const [user, setUser] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  // Round practice (a chosen packet, start to finish) or marathon (endless,
  // sampled from a pool). Marathon was its own tab before; both live here now.
  const [gameKind, setGameKind] = useState('round');
  const [marathonConfig, setMarathonConfig] = useState(DEFAULT_MARATHON_CONFIG);
  const seedRef = useRef(0);

  useEffect(() => {
    if (!preselectedRoundId) return;
    setSelectedRoundId(current => current || preselectedRoundId);
  }, [preselectedRoundId]);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => setUser(null));
  }, []);

  const { data: rounds = [] } = useQuery({
    queryKey: ['rounds-playable'],
    // Marathon pools draw from the whole library, so fetch generously.
    queryFn: () => base44.entities.Round.filter({ parse_status: 'success' }, '-created_date', 200),
  });

  const selectedRound = rounds.find(r => r.id === selectedRoundId);
  const isMarathon = gameKind === 'marathon';

  // Pools rebuild whenever the config changes, so mid-run tweaks to question
  // types apply from the next draw onward.
  const marathonPools = useMemo(() => buildMarathonPools(rounds, {
    roundIds: marathonConfig.roundIds,
    roundFilter: marathonConfig.roundFilter,
    questionTypes: settings.question_types,
    subjectFreq: marathonConfig.subjectFreq,
  }), [rounds, marathonConfig, settings.question_types]);

  const buildQuestionQueue = useCallback(
    (round, cfg) => applyQuestionRules(round.questions, cfg),
    [],
  );

  // Marathon draws one question at a time, so the boss-up rewrite is applied to
  // each draw rather than to a list.
  const drawMarathonQuestion = useCallback((k) => {
    const q = marathonQuestionAt(marathonPools, seedRef.current, k);
    return settings.boss_ups ? asBossUp(q) : q;
  }, [marathonPools, settings.boss_ups]);

  const handleStart = () => {
    if (isMarathon) {
      if (marathonPools.poolSize === 0) {
        toast.error('No questions match the selected filters. Adjust subjects or packets.');
        return;
      }
      // Endless: question k is drawn on demand from (seed, k) rather than
      // pre-building a queue, so the run never runs out.
      seedRef.current = randomSeed();
      setActiveQuestions([drawMarathonQuestion(0)]);
    } else {
      if (!selectedRound) return;
      const qs = buildQuestionQueue(selectedRound, settings);
      if (qs.length === 0) {
        toast.error('No questions match the selected filters.');
        return;
      }
      setActiveQuestions(qs);
    }
    setCurrentIndex(0);
    setResults([]);
    setBonusFor(null);
    setWaitingForBonus(false);
    setGameState('playing');
  };

  const currentQuestion = activeQuestions[currentIndex];

  // Counter numbering: round practice counts tossup/bonus pairs (12.T of 23).
  // Marathon has no pairs — every draw stands alone — so it numbers the draws
  // and just marks which kind each one is.
  const positions = useMemo(() => pairPositions(activeQuestions), [activeQuestions]);
  const positionLabelAt = useCallback((index) => {
    if (index == null || index < 0) return null;
    if (!isMarathon) return positions.labels[index] ?? null;
    const q = activeQuestions[index];
    return `${index + 1}.${(q?.original_type || q?.type) === 'BONUS' ? 'B' : 'T'}`;
  }, [isMarathon, positions, activeQuestions]);
  const positionLabel = positionLabelAt(currentIndex);
  // Index-aligned with `results`, for the score panel and the results review.
  const resultLabels = results.map(r => positionLabelAt(r.questionIndex));

  const handleAnswer = (result) => {
    setResults(prev => [...prev, { ...result, questionIndex: currentIndex }]);

    const nextQ = activeQuestions[currentIndex + 1];
    const hasNextBonus = nextQ?.type === 'BONUS' && !settings.skip_bonuses;

    if (result.type === 'TOSSUP') {
      // Tossup correct → bonus earned; wrong → no bonus
      if (result.result === 'correct' && hasNextBonus) {
        setWaitingForBonus(true);
        setBonusFor('You');
      } else {
        setWaitingForBonus(false);
        setBonusFor(null);
      }
    } else if (result.type === 'BONUS') {
      // Bonus answered: a chained bonus is only read if this bonus was correct
      if (result.result === 'correct' && hasNextBonus) {
        setWaitingForBonus(true);
        setBonusFor('You');
      } else {
        setWaitingForBonus(false);
        setBonusFor(null);
      }
    }
  };

  const handleNext = () => {
    // Marathon: draw the next question instead of walking a fixed queue. Each
    // sampled question stands alone — no bonus ownership to carry.
    if (isMarathon) {
      const k = currentIndex + 1;
      const q = drawMarathonQuestion(k);
      if (!q) { finishGame(); return; } // pools emptied by a live filter change
      setActiveQuestions(prev => [...prev, q]);
      setWaitingForBonus(false);
      setBonusFor(null);
      setCurrentIndex(k);
      return;
    }

    let nextIdx = currentIndex + 1;

    // Skip ALL consecutive unearned bonuses (covers bonus-after-bonus chains)
    while (nextIdx < activeQuestions.length && activeQuestions[nextIdx].type === 'BONUS' && !waitingForBonus) {
      nextIdx++;
    }

    if (nextIdx >= activeQuestions.length) {
      finishGame();
      return;
    }

    setWaitingForBonus(false);
    const nextQ = activeQuestions[nextIdx];
    setBonusFor(nextQ?.type === 'BONUS' ? 'You' : null);
    setCurrentIndex(nextIdx);
  };

  const finishGame = async () => {
    setGameState('finished');

    if (user) {
      try {
        const score = calculateScore(results, { powers: !!settings.powers });

        const existing = await base44.entities.UserStats.filter({ user_email: user.email }, '-created_date', 1);
        const stats = existing[0];
        const correct = results.filter(r => r.result === 'correct').length;

        const subjectStats = { ...(stats?.subject_stats || {}) };
        results.forEach((r) => {
          const q = activeQuestions[r.questionIndex];
          if (!q) return;
          const s = q.subject || 'General Science';
          if (!subjectStats[s]) subjectStats[s] = { correct: 0, total: 0 };
          subjectStats[s].total++;
          if (r.result === 'correct') subjectStats[s].correct++;
        });

        const negs = results.filter(r => r.result === 'interrupt_wrong').length;
        const powers = results.filter(r => r.result === 'correct' && r.interrupted).length;
        const tossups_total = activeQuestions.filter(q => q.type === 'TOSSUP').length;
        const bonuses_total = activeQuestions.filter(q => q.type === 'BONUS').length;

        // Build subject breakdown for analytics
        const subject_breakdown = {};
        results.forEach((r) => {
          const q = activeQuestions[r.questionIndex];
          if (!q) return;
          const s = q.subject || 'General Science';
          if (!subject_breakdown[s]) subject_breakdown[s] = { correct: 0, total: 0 };
          subject_breakdown[s].total++;
          if (r.result === 'correct') subject_breakdown[s].correct++;
        });

        const sessionId = `solo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        setSessionId(sessionId);

        const newGame = {
          session_id: sessionId,
          round_title: selectedRound?.title || 'Unknown',
          score,
          correct,
          total: results.length,
          negs,
          powers,
          tossups_total,
          bonuses_total,
          subject_breakdown,
          mode: 'solo',
          date: new Date().toISOString(),
          notes: '',
          subjects_played: settings.subjects || [],
          // `powers` above is the count of correct interrupts; this records
          // whether they were *scored* as powers (+6) in this game.
          powers_enabled: !!settings.powers,
          boss_ups: !!settings.boss_ups,
        };
        const gameHistory = [...(stats?.game_history || []), newGame].slice(-50);
        const roundsPlayed = [...new Set([...(stats?.rounds_played || []), selectedRoundId].filter(Boolean))];

        if (stats) {
          await base44.entities.UserStats.update(stats.id, {
            total_games: (stats.total_games || 0) + 1,
            total_questions_answered: (stats.total_questions_answered || 0) + results.length,
            total_correct: (stats.total_correct || 0) + correct,
            total_score: (stats.total_score || 0) + score,
            subject_stats: subjectStats,
            game_history: gameHistory,
            rounds_played: roundsPlayed,
          });
        } else {
          await base44.entities.UserStats.create({
            user_email: user.email,
            total_games: 1,
            total_questions_answered: results.length,
            total_correct: correct,
            total_score: score,
            subject_stats: subjectStats,
            game_history: [newGame],
            rounds_played: [selectedRoundId].filter(Boolean),
          });
        }
      } catch (e) {
        console.error('Failed to save stats', e);
      }
    }
  };

  const handleReplay = () => {
    setGameState('setup');
    setResults([]);
    setCurrentIndex(0);
    setActiveQuestions([]);
    setBonusFor(null);
    setSessionId(null);
  };

  if (gameState === 'finished' || gameState === 'abandoned') {
    return (
      <div className="p-6 lg:p-8">
        <GameResults
          results={results}
          questions={activeQuestions}
          onReplay={handleReplay}
          roundTitle={isMarathon ? 'Marathon' : (selectedRound?.title || 'Unknown Round')}
          mode={isMarathon ? 'marathon' : 'solo'}
          subjectsFilter={settings.subjects || []}
          hideLeaderboard={gameState === 'abandoned'}
          isPartial={gameState === 'abandoned'}
          sessionId={sessionId}
          powers={!!settings.powers}
          bossUps={!!settings.boss_ups}
          positionLabels={resultLabels}
        />
      </div>
    );
  }

  if (gameState === 'playing') {
    return (
      <div className="p-6 lg:p-8 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                {isMarathon && <Timer className="w-4 h-4 text-primary flex-shrink-0" />}
                <h2 className="font-semibold text-base truncate">
                  {isMarathon ? 'Marathon' : selectedRound?.title}
                </h2>
                {isMarathon && currentQuestion?.question_set && (
                  <Badge variant="outline" className="text-xs">{currentQuestion.question_set}</Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground/60">Space=Buzz · N=Next · P=Pause · Q=Quit</span>
            </div>
            {currentQuestion && (
              <QuestionReader
                question={currentQuestion}
                questionIndex={currentIndex}
                totalQuestions={isMarathon ? Infinity : activeQuestions.length}
                positionLabel={positionLabel}
                totalPositions={isMarathon ? Infinity : positions.totalPairs}
                settings={settings}
                onAnswer={handleAnswer}
                onNext={handleNext}
                onPause={() => setPaused(p => !p)}
                onQuit={() => { setPaused(false); setGameState('abandoned'); }}
                isBonusFor={currentQuestion.type === 'BONUS' ? bonusFor : null}
              />
            )}
          </div>
          <div>
            {/* Index-aligned to `results` (results[i] ↔ questions[i]) so a row
                opens the question it actually scored — `questionIndex` and
                position diverge whenever unearned bonuses are skipped. */}
            <ScoreBoard
              results={results}
              playerName={user?.full_name || 'You'}
              questions={results.map(r => activeQuestions[r.questionIndex])}
              powers={!!settings.powers}
              positionLabels={resultLabels}
            />
            {isMarathon && (
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Endless mode — quit (Q) whenever you&apos;re done to see results.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-1">Solo Practice</h1>
        <p className="text-muted-foreground">
          Play a specific round, or run an endless marathon from a pool of your choosing
        </p>
      </div>

      <div className="mb-6">
        <label className="text-sm font-medium mb-2 block">Game Type</label>
        <GameKindSelect value={gameKind} onChange={setGameKind} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Source: one packet, or a sampled pool */}
        {isMarathon ? (
          <MarathonSetup
            rounds={rounds}
            config={marathonConfig}
            onChange={setMarathonConfig}
            poolSize={marathonPools.poolSize}
          />
        ) : (
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" /> Select Round
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <RoundSelect rounds={rounds} value={selectedRoundId} onChange={setSelectedRoundId} />

              {selectedRound && (
                <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                  <p className="text-sm font-medium">{selectedRound.title}</p>
                  <div className="flex flex-wrap gap-1">
                    {[...new Set(selectedRound.questions?.map(q => q.subject).filter(Boolean))].map(s => (
                      <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedRound.questions?.filter(q => q.type === 'TOSSUP').length || 0} tossups ·{' '}
                    {selectedRound.questions?.filter(q => q.type === 'BONUS').length || 0} bonuses
                  </p>
                </div>
              )}

              {rounds.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No rounds available. <br />
                  <a href="/database" className="text-primary underline">Upload one first</a>
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Settings */}
        <div className="space-y-4">
          <GameSettings
            settings={settings}
            onChange={setSettings}
            onStart={isMarathon ? undefined : handleStart}
            disabled={!selectedRoundId}
            hideStart={isMarathon}
          />
          {isMarathon && (
            <Button
              size="lg"
              className="w-full font-semibold"
              onClick={handleStart}
              disabled={marathonPools.poolSize === 0}
            >
              <Play className="w-4 h-4 mr-2" />
              Start Endless Marathon ({marathonPools.poolSize} questions in pool)
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}