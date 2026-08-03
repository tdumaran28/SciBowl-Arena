import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Medal, ChevronDown, ChevronUp, Zap, XCircle } from 'lucide-react';
import { format } from 'date-fns';

const MEDAL_COLORS = ['text-amber-500', 'text-slate-400', 'text-orange-500'];

function EntryRow({ entry, rank }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = entry.subject_points && Object.keys(entry.subject_points).length > 0;

  return (
    <div className="border-b border-border last:border-0">
      <div
        className="flex items-center gap-3 px-5 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={() => hasDetails && setExpanded(v => !v)}
      >
        <span className={`w-5 text-center font-bold text-sm flex-shrink-0 ${MEDAL_COLORS[rank] || 'text-muted-foreground'}`}>
          {rank < 3 ? <Medal className="w-4 h-4 inline" /> : rank + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm truncate">{entry.username}</p>
            {entry.mode === 'multiplayer' && (
              <Badge variant="outline" className="text-[10px] px-1 py-0">MP</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">{entry.round_title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            {entry.negs > 0 && (
              <span className="text-xs text-destructive flex items-center gap-0.5">
                <XCircle className="w-3 h-3" />{entry.negs}
              </span>
            )}
            {entry.correct_interrupts > 0 && (
              <span className="text-xs text-primary flex items-center gap-0.5">
                <Zap className="w-3 h-3" />{entry.correct_interrupts}
              </span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0 flex items-center gap-1.5">
          <div>
            <Badge variant="secondary" className="font-bold">{entry.score} pts</Badge>
            {entry.date && (
              <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(entry.date), 'MMM d')}</p>
            )}
          </div>
          {hasDetails && (
            expanded
              ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </div>

      {expanded && hasDetails && (
        <div className="px-5 pb-3 bg-muted/20">
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Points by subject:</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(entry.subject_points).map(([subj, pts]) => (
              <span key={subj}
                className={`text-xs px-2 py-0.5 rounded-full border font-medium ${pts >= 0 ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400' : 'bg-destructive/10 border-destructive/30 text-destructive'}`}>
                {subj}: {pts >= 0 ? '+' : ''}{pts}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeaderboardSection() {
  const [tab, setTab] = useState('standard');

  const { data: allEntries = [] } = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => base44.entities.LeaderboardEntry.list('-score', 100),
    refetchInterval: 30000,
  });

  // Marathon games have their own board; among the rest: Standard = covers all
  // required subjects (Energy optional); Custom = subject-filtered or missing
  // required subjects.
  const REQUIRED_SUBJECTS = ['Biology', 'Chemistry', 'Physics', 'Earth and Space', 'Math'];
  const isMarathon = (entry) => entry.mode === 'marathon';
  const isStandard = (entry) => {
    // If subjects_filter is set the player deliberately filtered — always custom
    if (entry.subjects_filter?.length > 0) return false;
    // Check subject_points covers all required subjects
    const playedSubjects = Object.keys(entry.subject_points || {});
    return REQUIRED_SUBJECTS.every(s => playedSubjects.includes(s));
  };
  const standardEntries = allEntries.filter(e => !isMarathon(e) && isStandard(e)).slice(0, 20);
  const customEntries = allEntries.filter(e => !isMarathon(e) && !isStandard(e)).slice(0, 20);
  const marathonEntries = allEntries.filter(isMarathon).slice(0, 20);
  const entries = tab === 'standard' ? standardEntries : tab === 'custom' ? customEntries : marathonEntries;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" /> Leaderboard
        </CardTitle>
        {/* Tab switcher */}
        <div className="flex gap-1 mt-1">
          <button
            onClick={() => setTab('standard')}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${tab === 'standard' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Standard
          </button>
          <button
            onClick={() => setTab('custom')}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${tab === 'custom' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Custom Games
          </button>
          <button
            onClick={() => setTab('marathon')}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${tab === 'marathon' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
          >
            Marathon
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {entries.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">
            {tab === 'standard'
              ? 'No standard scores yet. Finish a game to be first!'
              : tab === 'custom'
                ? 'No custom game scores yet. Play with subject filters to appear here!'
                : 'No marathon scores yet. Run an endless marathon to be first!'}
          </div>
        ) : (
          <div>
            {tab === 'custom' && (
              <div className="px-5 pt-3 pb-1">
                <p className="text-xs text-muted-foreground">Scores from games played with subject filters. Subjects shown per entry.</p>
              </div>
            )}
            {entries.map((entry, i) => (
              <EntryRow key={entry.id} entry={entry} rank={i} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}