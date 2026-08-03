import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SUBJECT_COLORS } from '@/utils/parseRound';
import { TrendingUp, Zap, XCircle, BarChart2 } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  BarChart, Bar
} from 'recharts';
import { format } from 'date-fns';

const SUBJECT_CHART_COLORS = {
  'Biology': '#10b981',
  'Chemistry': '#3b82f6',
  'Physics': '#8b5cf6',
  'Earth and Space': '#f59e0b',
  'Math': '#f43f5e',
  'Energy': '#f97316',
  'General Science': '#64748b',
};

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium text-foreground">{p.value}{p.name === '% of Max' ? '%' : ''}</span>
        </div>
      ))}
    </div>
  );
}

/** Build per-game chart data from game_history */
function buildGameSeries(gameHistory) {
  // Oldest → newest (left → right). gameHistory is stored oldest-first.
  return [...gameHistory].slice(-30).map((g, i) => {
    const totalPossible = ((g.tossups_total || 0) * 4) + ((g.bonuses_total || 0) * 10);
    const pct = totalPossible > 0 ? Math.round((g.score / totalPossible) * 100) : null;
    return {
      name: g.date ? format(new Date(g.date), 'MMM d') : `Game ${i + 1}`,
      score: g.score || 0,
      pctMax: pct,
      correct: g.correct || 0,
      total: g.total || 0,
      negs: g.negs || 0,
      powers: g.powers || 0,
      round: g.round_title || '',
    };
  });
}

/** Build subject accuracy over time from game_history that has subject_breakdown */
function buildSubjectSeries(gameHistory, subjects) {
  // Oldest → newest (left → right)
  return [...gameHistory].slice(-20).map((g, i) => {
    const entry = {
      name: g.date ? format(new Date(g.date), 'MMM d') : `G${i + 1}`,
      round: g.round_title || '',
    };
    subjects.forEach(s => {
      const sb = g.subject_breakdown?.[s];
      if (sb && sb.total > 0) {
        entry[s] = Math.round((sb.correct / sb.total) * 100);
      }
    });
    return entry;
  });
}

export default function PerformanceCharts({ gameHistory = [], subjectStats = {} }) {
  const [activeSubjectTab, setActiveSubjectTab] = useState('overall');
  const [showActualScore, setShowActualScore] = useState(false);

  const subjects = Object.keys(subjectStats).filter(s => subjectStats[s]?.total > 0);
  const gameSeries = buildGameSeries(gameHistory);
  const subjectSeries = buildSubjectSeries(gameHistory, subjects);

  const totalNegs = gameHistory.reduce((s, g) => s + (g.negs || 0), 0);
  const totalPowers = gameHistory.reduce((s, g) => s + (g.powers || 0), 0);
  const totalCorrect = gameHistory.reduce((s, g) => s + (g.correct || 0), 0);
  const totalQs = gameHistory.reduce((s, g) => s + (g.total || 0), 0);

  // Per-subject negs/powers from subjectStats if available
  const subjectNegPower = Object.entries(subjectStats).map(([subj, s]) => ({
    subject: subj,
    correct: s.correct || 0,
    total: s.total || 0,
    pct: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
  }));

  return (
    <div className="space-y-5">
      {/* Overall performance summary mini-stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-border/60">
          <CardContent className="p-4 text-center">
            <XCircle className="w-4 h-4 text-destructive mx-auto mb-1" />
            <p className="text-xl font-bold text-destructive">{totalNegs}</p>
            <p className="text-xs text-muted-foreground">Total Negs</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4 text-center">
            <Zap className="w-4 h-4 text-primary mx-auto mb-1" />
            <p className="text-xl font-bold text-primary">{totalPowers}</p>
            <p className="text-xs text-muted-foreground">Power Buzzes</p>
          </CardContent>
        </Card>
        <Card className="border-border/60">
          <CardContent className="p-4 text-center">
            <TrendingUp className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
            <p className="text-xl font-bold text-emerald-500">
              {totalQs > 0 ? Math.round((totalCorrect / totalQs) * 100) : 0}%
            </p>
            <p className="text-xs text-muted-foreground">Overall Accuracy</p>
          </CardContent>
        </Card>
      </div>

      {/* Score over time — % of max potential, click to toggle actual points */}
      {gameSeries.length >= 1 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" /> Score Over Time
              </CardTitle>
              <div className="flex gap-1">
                <button
                  onClick={() => setShowActualScore(false)}
                  className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${!showActualScore ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  % of Max
                </button>
                <button
                  onClick={() => setShowActualScore(true)}
                  className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${showActualScore ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  Actual Pts
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground font-normal mt-1">
              {showActualScore
                ? 'Actual points scored per game'
                : '% of max potential (10×bonuses + 4×tossups) — click chart to toggle'}
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={gameSeries}
                margin={{ top: 4, right: 12, left: -20, bottom: 0 }}
                onClick={() => setShowActualScore(v => !v)}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis
                  domain={showActualScore ? [0, 'auto'] : [0, 100]}
                  unit={showActualScore ? '' : '%'}
                  tick={{ fontSize: 10 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey={showActualScore ? 'score' : 'pctMax'}
                  name={showActualScore ? 'Points' : '% of Max'}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Negs + Powers over time */}
      {gameSeries.length >= 2 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" /> Negs & Powers Per Game
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={gameSeries} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip content={<CustomTooltip />} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="powers" name="Powers" fill="#6366f1" radius={[2, 2, 0, 0]} />
                <Bar dataKey="negs" name="Negs" fill="#ef4444" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Subject accuracy over time */}
      {subjects.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-primary" /> Subject Performance Over Time
              </CardTitle>
              <div className="flex gap-1 flex-wrap">
                <button
                  onClick={() => setActiveSubjectTab('overall')}
                  className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${activeSubjectTab === 'overall' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  Overall
                </button>
                {subjects.map(s => (
                  <button
                    key={s}
                    onClick={() => setActiveSubjectTab(s)}
                    className={`text-[10px] px-2 py-0.5 rounded font-medium transition-colors ${activeSubjectTab === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {activeSubjectTab === 'overall' ? (
              /* Overall bar chart by subject */
              <div className="space-y-2">
                {subjectNegPower.map(({ subject, correct, total, pct }) => (
                  <div key={subject} className="flex items-center gap-3">
                    <Badge variant="secondary" className={`text-xs flex-shrink-0 w-28 justify-center ${SUBJECT_COLORS[subject] || ''}`}>
                      {subject}
                    </Badge>
                    <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-destructive'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-24 text-right">{correct}/{total} ({pct}%)</span>
                  </div>
                ))}
              </div>
            ) : (
              /* Line chart for a specific subject over recent games */
              subjectSeries.some(g => g[activeSubjectTab] !== undefined) ? (
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={subjectSeries} margin={{ top: 4, right: 12, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip content={<CustomTooltip />} />
                    <Line
                      type="monotone"
                      dataKey={activeSubjectTab}
                      name="Accuracy %"
                      stroke={SUBJECT_CHART_COLORS[activeSubjectTab] || '#6366f1'}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No per-game subject breakdown available yet for {activeSubjectTab}.<br />
                  Subject trends appear after playing games with detailed tracking.
                </p>
              )
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent games table */}
      {gameHistory.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent Games Detail</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Round</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Score</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Correct</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Negs</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Powers</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {[...gameHistory].slice(-15).reverse().map((g, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2 font-medium truncate max-w-[160px]">{g.round_title || '—'}</td>
                      <td className="px-3 py-2 text-right font-bold text-primary">{g.score || 0}</td>
                      <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400">{g.correct || 0}/{g.total || 0}</td>
                      <td className="px-3 py-2 text-right text-destructive">{g.negs || 0}</td>
                      <td className="px-3 py-2 text-right text-indigo-500">{g.powers || 0}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {g.date ? format(new Date(g.date), 'MMM d') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}