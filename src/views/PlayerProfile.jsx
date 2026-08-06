import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useQuery } from '@tanstack/react-query';
import { User, Trophy, Target, BookOpen, Pencil, Save, X, StickyNote, BarChart2, Clock, TrendingUp, Trash2, Loader2 } from 'lucide-react';
import PerformanceCharts from '@/components/profile/PerformanceCharts';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function PlayerProfile() {
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [username, setUsername] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [editingGameNotes, setEditingGameNotes] = useState(false);
  const [gameNotes, setGameNotes] = useState('');
  const [activeTab, setActiveTab] = useState('history'); // 'history' | 'analytics'
  const [postedKeys, setPostedKeys] = useState(new Set());
  const [postingGameIdx, setPostingGameIdx] = useState(null);

  const { data: rounds = [] } = useQuery({
    queryKey: ['rounds-profile'],
    queryFn: () => base44.entities.Round.filter({ parse_status: 'success' }, '-created_date', 200),
  });

  useEffect(() => {
    base44.auth.me()
      .then(async (u) => {
        setUser(u);
        const existing = await base44.entities.UserStats.filter({ user_email: u.email }, '-created_date', 1);
        if (existing[0]) {
          setStats(existing[0]);
          setUsername(existing[0].username || u.full_name || '');
          setNotes(existing[0].notes || '');
        } else {
          setUsername(u.full_name || '');
        }
      })
      .catch(() => {});
  }, []);

  // Saves a field on the user's stats record, creating the record on first
  // save so a new player can set a username/notes before playing any games.
  const saveStatsField = async (field, value) => {
    if (stats?.id) {
      return base44.entities.UserStats.update(stats.id, { [field]: value });
    }
    return base44.entities.UserStats.create({ user_email: user.email, [field]: value });
  };

  const saveUsername = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const updated = await saveStatsField('username', username);
      setStats(updated);
      setEditingUsername(false);
      toast.success('Username saved');
    } catch {
      toast.error('Failed to save username');
    }
    setSaving(false);
  };

  const saveNotes = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const updated = await saveStatsField('notes', notes);
      setStats(updated);
      setEditingNotes(false);
      toast.success('Notes saved');
    } catch {
      toast.error('Failed to save notes');
    }
    setSaving(false);
  };

  const saveGameNotes = async () => {
    if (!stats?.id || !selectedGame) return;
    setSaving(true);
    const history = (stats.game_history || []).map((g, i) =>
      i === selectedGame.index ? { ...g, notes: gameNotes } : g
    );
    const updated = await base44.entities.UserStats.update(stats.id, { game_history: history });
    setStats(updated);
    setEditingGameNotes(false);
    setSaving(false);
    toast.success('Game notes saved');
  };

  const deleteGame = async (idx) => {
    if (!stats?.id) return;
    const gameToDelete = gameHistory[idx];
    const history = gameHistory.filter((_, i) => i !== idx);
    // Recompute aggregates from remaining history
    const totalGames = history.length;
    const totalCorrect = history.reduce((s, g) => s + (g.correct || 0), 0);
    const totalQs = history.reduce((s, g) => s + (g.total || 0), 0);
    const totalScore = history.reduce((s, g) => s + (g.score || 0), 0);
    const updated = await base44.entities.UserStats.update(stats.id, {
      game_history: history,
      total_games: totalGames,
      total_correct: totalCorrect,
      total_questions_answered: totalQs,
      total_score: totalScore,
    });
    setStats(updated);
    if (selectedGame?.index === idx) setSelectedGame(null);
    toast.success('Game removed from history');
  };

  const resetAllStats = async () => {
    if (!user) return;
    if (!confirm('Reset ALL your statistics? This permanently clears your game history, rounds played, subject stats, totals, notes, and username, and removes your leaderboard entries. This cannot be undone.')) return;
    setSaving(true);
    try {
      // Remove the user's stats record entirely
      if (stats?.id) {
        await base44.entities.UserStats.delete(stats.id);
      }
      // Remove any leaderboard entries posted under this user's username
      const uname = (stats?.username || user?.full_name || '').trim();
      if (uname) {
        const mine = await base44.entities.LeaderboardEntry.filter({ username: uname }, '-created_date', 500);
        if (mine.length) {
          await base44.entities.LeaderboardEntry.deleteMany({ username: uname });
        }
      }
      setStats(null);
      setUsername(user?.full_name || '');
      setNotes('');
      setEditingUsername(false);
      setEditingNotes(false);
      setSelectedGame(null);
      toast.success('Your statistics and profile have been reset');
    } catch (e) {
      toast.error('Failed to reset statistics');
    }
    setSaving(false);
  };

  const loadPostedKeys = async (uname) => {
    if (!uname) { setPostedKeys(new Set()); return; }
    try {
      const entries = await base44.entities.LeaderboardEntry.filter({ username: uname }, '-created_date', 500);
      setPostedKeys(new Set(entries.map(e => `${e.round_title}|${e.score}|${e.correct}|${e.total}|${e.mode}`)));
    } catch {}
  };

  useEffect(() => {
    const uname = (stats?.username || user?.full_name || '').trim();
    loadPostedKeys(uname);
  }, [stats?.username, user?.full_name]);

  const postGameToLeaderboard = async (idx) => {
    const g = gameHistory[idx];
    if (!g) return;
    const uname = (stats?.username || user?.full_name || '').trim();
    if (!uname) { toast.error('Set a leaderboard username first'); return; }
    setPostingGameIdx(idx);
    try {
      const sb = g.subject_breakdown || {};
      const totalCorrect = Object.values(sb).reduce((s, v) => s + (v.correct || 0), 0) || g.correct || 1;
      const subjectPoints = {};
      Object.entries(sb).forEach(([subj, v]) => {
        if (v.correct) subjectPoints[subj] = Math.round((g.score || 0) * (v.correct / totalCorrect));
      });
      await base44.entities.LeaderboardEntry.create({
        username: uname,
        score: g.score || 0,
        round_title: g.round_title,
        correct: g.correct || 0,
        total: g.total || 0,
        negs: g.negs || 0,
        correct_interrupts: g.powers || 0,
        subject_points: subjectPoints,
        subjects_filter: (g.subjects_played && g.subjects_played.length) ? g.subjects_played : [],
        // Powers are a house rule, so those scores belong on the custom board
        // alongside subject-filtered games.
        powers: !!g.powers_enabled,
        boss_ups: !!g.boss_ups,
        is_custom: !!(g.subjects_played && g.subjects_played.length) || !!g.powers_enabled || !!g.boss_ups,
        mode: g.mode || 'solo',
        date: g.date || new Date().toISOString(),
      });
      setPostedKeys(prev => new Set([...prev, `${g.round_title}|${g.score}|${g.correct}|${g.total}|${g.mode}`]));
      toast.success('Score posted to leaderboard');
    } catch (e) {
      toast.error('Failed to post score');
    }
    setPostingGameIdx(null);
  };

  const unpostGame = async (idx) => {
    const g = gameHistory[idx];
    if (!g) return;
    const uname = (stats?.username || user?.full_name || '').trim();
    if (!uname) return;
    setPostingGameIdx(idx);
    try {
      await base44.entities.LeaderboardEntry.deleteMany({
        username: uname,
        round_title: g.round_title,
        score: g.score || 0,
        correct: g.correct || 0,
        total: g.total || 0,
        mode: g.mode || 'solo',
      });
      setPostedKeys(prev => {
        const next = new Set(prev);
        next.delete(`${g.round_title}|${g.score}|${g.correct}|${g.total}|${g.mode}`);
        return next;
      });
      toast.success('Score removed from leaderboard');
    } catch (e) {
      toast.error('Failed to remove score');
    }
    setPostingGameIdx(null);
  };

  const gameHistory = stats?.game_history || [];
  const subjectStats = stats?.subject_stats || {};
  const roundsPlayed = new Set(stats?.rounds_played || []);
  const accuracy = stats?.total_questions_answered > 0
    ? Math.round((stats.total_correct / stats.total_questions_answered) * 100) : null;
  const bestScore = gameHistory.length > 0 ? Math.max(...gameHistory.map(g => g.score || 0)) : 0;

  if (!user) {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-64">
        <p className="text-muted-foreground">Loading profile…</p>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-2">
        <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center">
          <User className="w-8 h-8 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{user.full_name || user.email}</h1>
          <p className="text-muted-foreground text-sm">{user.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: identity + notes */}
        <div className="space-y-4">
          {/* Username */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-500" /> Leaderboard Username
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editingUsername ? (
                <div className="space-y-2">
                  <Input value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter username…" maxLength={32} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveUsername} disabled={saving || !username.trim()}>
                      <Save className="w-3.5 h-3.5 mr-1" />{saving ? 'Saving…' : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingUsername(false)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-semibold flex-1">{username || <span className="text-muted-foreground italic">Not set</span>}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditingUsername(true)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* General notes */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <StickyNote className="w-4 h-4 text-primary" /> Personal Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {editingNotes ? (
                <div className="space-y-2">
                  <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Study notes, reminders…" rows={5} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveNotes} disabled={saving}>
                      <Save className="w-3.5 h-3.5 mr-1" />{saving ? 'Saving…' : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingNotes(false)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap min-h-[40px]">
                    {notes || <span className="italic">No notes yet</span>}
                  </p>
                  <Button size="sm" variant="ghost" className="mt-2 -ml-1" onClick={() => setEditingNotes(true)}>
                    <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rounds played/not played */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-primary" /> Rounds
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {rounds.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${roundsPlayed.has(r.id) ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`} />
                    <span className={`truncate ${roundsPlayed.has(r.id) ? 'text-foreground' : 'text-muted-foreground'}`}>{r.title}</span>
                    {roundsPlayed.has(r.id) && <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto">Played</Badge>}
                  </div>
                ))}
                {rounds.length === 0 && <p className="text-xs text-muted-foreground">No rounds available</p>}
              </div>
            </CardContent>
            </Card>

            {/* Reset statistics */}
            <Card className="border-destructive/30">
            <CardHeader className="pb-2">
             <CardTitle className="text-base flex items-center gap-2 text-destructive">
               <Trash2 className="w-4 h-4" /> Reset Statistics
             </CardTitle>
            </CardHeader>
            <CardContent>
             <p className="text-xs text-muted-foreground mb-3">
               Permanently clears your game history, rounds played, subject performance, totals, notes, username, and leaderboard entries.
             </p>
             <Button size="sm" variant="outline" className="text-destructive border-destructive/40 hover:bg-destructive/10" onClick={resetAllStats} disabled={saving}>
               <Trash2 className="w-3.5 h-3.5 mr-1" /> Reset My Statistics & Profile
             </Button>
            </CardContent>
            </Card>
            </div>

            {/* Right: stats + history */}
        <div className="lg:col-span-2 space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: Trophy, label: 'Games', value: stats?.total_games || 0, color: 'text-amber-500' },
              { icon: Target, label: 'Accuracy', value: accuracy !== null ? `${accuracy}%` : '—', color: 'text-emerald-500' },
              { icon: BarChart2, label: 'Best Score', value: bestScore, color: 'text-primary' },
              { icon: BookOpen, label: 'Total Score', value: stats?.total_score || 0, color: 'text-accent' },
            ].map(({ icon: Icon, label, value, color }) => (
              <Card key={label} className="border-border/60">
                <CardContent className="p-4">
                  <Icon className={`w-4 h-4 ${color} mb-2`} />
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Tab switcher */}
          <div className="flex gap-1 border-b border-border pb-2">
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'history' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <Clock className="w-3.5 h-3.5" /> Game History
            </button>
            <button
              onClick={() => setActiveTab('analytics')}
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md font-medium transition-colors ${activeTab === 'analytics' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              <TrendingUp className="w-3.5 h-3.5" /> Performance/Analytics
            </button>
          </div>

          {activeTab === 'analytics' ? (
            <PerformanceCharts gameHistory={gameHistory} subjectStats={subjectStats} />
          ) : (
            <>
              {/* Game history */}
              <Card className="border-border/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" /> Game History
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {gameHistory.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-6">No games played yet</p>
                  ) : (
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {[...gameHistory].reverse().map((g, i) => {
                        const idx = gameHistory.length - 1 - i;
                        const isSelected = selectedGame?.index === idx;
                        const gameKey = `${g.round_title}|${g.score}|${g.correct}|${g.total}|${g.mode}`;
                        const isPosted = postedKeys.has(gameKey);
                        return (
                          <div key={i}
                            className={`rounded-lg border p-3 cursor-pointer transition-colors ${isSelected ? 'border-primary/40 bg-primary/5' : 'border-border hover:bg-muted/30'}`}
                            onClick={() => {
                              setSelectedGame({ ...g, index: idx });
                              setGameNotes(g.notes || '');
                              setEditingGameNotes(false);
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-sm truncate">{g.round_title}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <Badge variant="secondary" className="text-xs">{g.score || 0} pts</Badge>
                                  {g.mode === 'multiplayer' && <Badge variant="outline" className="text-xs">Multiplayer</Badge>}
                                  {g.subjects_played?.length > 0 && (
                                    <Badge variant="outline" className="text-xs text-muted-foreground">
                                      {g.subjects_played.join(', ')}
                                    </Badge>
                                  )}
                                </div>
                                {g.notes && (
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1 italic">"{g.notes}"</p>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className="text-xs text-muted-foreground">
                                  {g.date ? format(new Date(g.date), 'MMM d') : ''}
                                </span>
                                {isPosted ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs gap-1 text-emerald-600 border border-emerald-500/30 hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40"
                                    onClick={e => { e.stopPropagation(); unpostGame(idx); }}
                                    disabled={postingGameIdx === idx}
                                    title="Click to remove this score from the leaderboard"
                                  >
                                    {postingGameIdx === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trophy className="w-2.5 h-2.5" />}
                                    Posted
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-xs gap-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                                    onClick={e => { e.stopPropagation(); postGameToLeaderboard(idx); }}
                                    disabled={postingGameIdx === idx || !username.trim()}
                                    title={!username.trim() ? 'Set a leaderboard username first' : 'Post this score to the leaderboard'}
                                  >
                                    {postingGameIdx === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trophy className="w-3 h-3" />}
                                    Post
                                  </Button>
                                )}
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="w-6 h-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  onClick={e => { e.stopPropagation(); deleteGame(idx); }}
                                  title="Delete this game"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Game notes editor */}
                  {selectedGame && (
                    <div className="mt-4 pt-4 border-t border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">Notes for: <span className="text-primary">{selectedGame.round_title}</span></p>
                        {!editingGameNotes && (
                          <Button size="sm" variant="ghost" onClick={() => setEditingGameNotes(true)}>
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
                          </Button>
                        )}
                      </div>
                      {editingGameNotes ? (
                        <div className="space-y-2">
                          <Textarea value={gameNotes} onChange={e => setGameNotes(e.target.value)} placeholder="Add notes for this game…" rows={3} />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={saveGameNotes} disabled={saving}>
                              <Save className="w-3.5 h-3.5 mr-1" />{saving ? 'Saving…' : 'Save'}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingGameNotes(false)}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          {selectedGame.notes || 'No notes for this game. Click Edit to add some.'}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}