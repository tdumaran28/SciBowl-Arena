import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import RoundMultiSelect from '@/components/game/RoundMultiSelect';
import { SUBJECTS, SUBJECT_COLORS } from '@/utils/parseRound';
import { effectiveShares } from '@/utils/marathon';
import { Shuffle } from 'lucide-react';
import { cn } from '@/lib/utils';

// Marathon pool configuration — which packets questions are drawn from and how
// often each subject comes up. Shared by Solo Play and Multiplayer so the two
// offer an identical marathon, which is why it lives here rather than in either
// view.

const ALL_SUBJECTS = [...SUBJECTS];

export const DEFAULT_MARATHON_CONFIG = {
  roundIds: [],
  roundFilter: 'all',
  subjectFreq: Object.fromEntries(ALL_SUBJECTS.map(s => [s, 50])),
};

export default function MarathonSetup({ rounds, config, onChange, poolSize }) {
  const { roundIds, roundFilter, subjectFreq } = config;
  const shares = useMemo(() => effectiveShares(subjectFreq), [subjectFreq]);
  const patch = (fields) => onChange({ ...config, ...fields });

  // Only public packets can be offered: every player derives their own copy of
  // the question sequence, so the pool has to be identical for all of them
  // (see buildMarathonPools). Private packets are played in round practice.
  const publicRounds = useMemo(() => rounds.filter(r => r?.is_public !== false), [rounds]);
  const privateCount = rounds.length - publicRounds.length;

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader className="pb-3"><CardTitle className="text-base">Packet Source</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2 block">Round Type</Label>
            <Select value={roundFilter} onValueChange={v => patch({ roundFilter: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Rounds</SelectItem>
                <SelectItem value="RR">Round Robin Only</SelectItem>
                <SelectItem value="DE">Double Elim Only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm font-medium mb-2 block">
              Packets in the Pool <span className="text-muted-foreground font-normal">(none selected = all)</span>
            </Label>
            <RoundMultiSelect
              rounds={publicRounds}
              selectedIds={roundIds}
              onChange={ids => patch({ roundIds: ids })}
            />
          </div>
          {typeof poolSize === 'number' && (
            <p className="text-xs text-muted-foreground">
              {poolSize > 0
                ? `${poolSize} questions in the pool — sampled with replacement, so the run never ends.`
                : 'No questions match these filters yet.'}
            </p>
          )}
          {privateCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {privateCount} private packet{privateCount === 1 ? ' is' : 's are'} excluded — marathon uses
              the shared public bank so every player draws from the same questions.
              Play private packets in <span className="font-medium text-foreground">round practice</span>.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Shuffle className="w-4 h-4 text-primary" /> Subject Frequency
          </CardTitle>
          <p className="text-xs text-muted-foreground font-normal">
            Set each subject from 0–100%. Weights are relative — the “share” shows the actual percentage of questions that subject will get.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {ALL_SUBJECTS.map(subj => (
            <div key={subj} className="flex items-center gap-3">
              <Badge
                variant={subjectFreq[subj] > 0 ? 'default' : 'outline'}
                className={cn('text-xs w-32 justify-center cursor-pointer', SUBJECT_COLORS[subj])}
                onClick={() => patch({
                  subjectFreq: { ...subjectFreq, [subj]: subjectFreq[subj] > 0 ? 0 : 50 },
                })}
              >
                {subj}
              </Badge>
              <Slider
                min={0} max={100} step={5}
                value={[subjectFreq[subj]]}
                onValueChange={([v]) => patch({ subjectFreq: { ...subjectFreq, [subj]: v } })}
                className="flex-1"
              />
              <span className="text-xs font-mono text-muted-foreground w-12 text-right">{subjectFreq[subj]}%</span>
              <span className={cn(
                'text-xs w-24 text-right',
                subjectFreq[subj] > 0 ? 'text-primary font-medium' : 'text-muted-foreground'
              )}>
                {subjectFreq[subj] > 0 ? `${Math.round((shares[subj] || 0) * 100)}% share` : 'Off'}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
