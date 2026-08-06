import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Trophy, Download, Loader2, CheckCircle2, StickyNote, Save } from 'lucide-react';
import { pointsFor, submittedText } from '@/utils/parseRound';
import { toast } from 'sonner';

function exportCSV(results, questions, roundTitle, powers) {
  const headers = ['#', 'Type', 'Subject', 'Format', 'Question', 'Your Answer', 'Correct Answer', 'Result', 'Points'];
  const rows = results.map((r, i) => {
    const q = questions[i];
    if (!q) return null;
    const pts = pointsFor(r.result, r.type, { interrupted: r.interrupted, powers });
    return [
      i + 1, q.type, q.subject || '', q.format || '',
      `"${(q.question_text || '').replace(/"/g, '""')}"`,
      `"${(submittedText(r, q) || 'No answer given').replace(/"/g, '""')}"`,
      `"${(q.answer || '').replace(/"/g, '""')}"`,
      r.result, pts,
    ];
  }).filter(Boolean);

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${roundTitle.replace(/[^a-z0-9]/gi, '_')}_results.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PostGameActions({ results, questions, roundTitle, score, mode = 'solo', subjectsFilter = [], hideLeaderboard = false, sessionId = null, powers = false, bossUps = false }) {
  // Leaderboard username comes straight from the signed-in profile — no
  // manual entry.
  const [username, setUsername] = useState('');
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [notes, setNotes] = useState('');
  const [notesSaved, setNotesSaved] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    base44.auth.me()
      .then(me => setUsername(me.full_name || me.email?.split('@')[0] || ''))
      .catch(() => {});
  }, []);

  const correct = results.filter(r => r.result === 'correct').length;
  const negs = results.filter(r => r.result === 'interrupt_wrong').length;
  const correctInterrupts = results.filter(r => r.result === 'correct' && r.interrupted).length;

  const subjectPoints = {};
  results.forEach((r, i) => {
    const q = questions[i];
    if (!q) return;
    const s = q.subject || 'General Science';
    if (!subjectPoints[s]) subjectPoints[s] = 0;
    subjectPoints[s] += pointsFor(r.result, r.type, { interrupted: r.interrupted, powers });
  });

  // A game is "standard" if the round covers all required subjects (Energy
  // optional) and was scored by the official rules. Powers and boss-ups are
  // house rules — their scores are not comparable to standard ones, so they go
  // to the custom board.
  const REQUIRED_SUBJECTS = ['Biology', 'Chemistry', 'Physics', 'Earth and Space', 'Math'];
  const playedSubjects = [...new Set(questions.map(q => q.subject).filter(Boolean))];
  const isCustom = powers || bossUps || subjectsFilter.length > 0
    || !REQUIRED_SUBJECTS.every(s => playedSubjects.includes(s));

  const handlePost = async () => {
    setPosting(true);
    try {
      // Resolve the username from the profile at post time (covers the case
      // where the mount-time fetch hadn't finished yet)
      let name = username.trim();
      if (!name) {
        const me = await base44.auth.me();
        name = me.full_name || me.email?.split('@')[0] || '';
        setUsername(name);
      }
      if (!name) throw new Error('Could not resolve your profile username');
      await base44.entities.LeaderboardEntry.create({
        username: name,
        score,
        round_title: roundTitle,
        correct,
        total: results.length,
        negs,
        correct_interrupts: correctInterrupts,
        subject_points: subjectPoints,
        subjects_filter: isCustom ? subjectsFilter : [],
        is_custom: isCustom,
        powers,
        boss_ups: bossUps,
        mode,
        date: new Date().toISOString(),
      });
      setPosted(true);
    } catch (err) {
      toast.error('Failed to post score: ' + (err.message || 'Unknown error'));
    }
    setPosting(false);
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      const me = await base44.auth.me();
      const existing = await base44.entities.UserStats.filter({ user_email: me.email }, '-created_date', 1);
      const stats = existing[0];
      if (stats && sessionId) {
        // Update notes on the existing game entry by session_id (no duplicate)
        const history = (stats.game_history || []).map(g =>
          g.session_id === sessionId ? { ...g, notes: notes.trim() } : g
        );
        await base44.entities.UserStats.update(stats.id, { game_history: history });
      } else if (stats) {
        // Fallback: update the most recent entry's notes
        const history = [...(stats.game_history || [])];
        if (history.length > 0) history[history.length - 1] = { ...history[history.length - 1], notes: notes.trim() };
        await base44.entities.UserStats.update(stats.id, { game_history: history });
      }
      setNotesSaved(true);
    } catch (e) {}
    setSavingNotes(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Notes */}
      <div className="space-y-2">
        <Label className="text-sm flex items-center gap-1.5">
          <StickyNote className="w-3.5 h-3.5" /> Game Notes
        </Label>
        <Textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="What did you learn? What to review?…"
          rows={3}
          disabled={notesSaved}
        />
        {notesSaved ? (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> Notes saved to your profile
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={handleSaveNotes} disabled={savingNotes || !notes.trim()}>
            {savingNotes ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Save Notes to Profile
          </Button>
        )}
      </div>

      {/* CSV Export */}
      <Button variant="outline" onClick={() => exportCSV(results, questions, roundTitle, powers)} className="w-full">
        <Download className="w-4 h-4 mr-2" /> Export Results as CSV
      </Button>

      {/* Leaderboard post — username is taken from your profile automatically */}
      {!hideLeaderboard && (
        posted ? (
          <div className="flex items-center gap-2 justify-center text-sm text-emerald-600 dark:text-emerald-400 py-2">
            <CheckCircle2 className="w-4 h-4" /> Score posted to leaderboard as {username}!
          </div>
        ) : (
          <div className="space-y-1">
            <Button variant="outline" onClick={handlePost} disabled={posting} className="w-full">
              {posting
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Trophy className="w-4 h-4 mr-2" />}
              Post Score to Leaderboard{username ? ` as ${username}` : ''}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              {mode === 'marathon'
                ? 'Posts to the Marathon leaderboard'
                : isCustom
                  ? `Posts to the Custom Game leaderboard${
                      [powers && 'powers', bossUps && 'boss-ups'].filter(Boolean).length
                        ? ` (${[powers && 'powers', bossUps && 'boss-ups'].filter(Boolean).join(', ')})`
                        : ''
                    }${subjectsFilter.length ? ` (subjects: ${subjectsFilter.join(', ')})` : ''}`
                  : 'Posts to the Standard leaderboard'} · username from your profile
            </p>
          </div>
        )
      )}
    </div>
  );
}