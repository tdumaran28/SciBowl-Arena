import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Settings2, Volume2, Zap, Clock, Sparkles, Swords } from 'lucide-react';
import { SUBJECTS, SCORING, BOSS_UP_EXTRA_SECONDS } from '@/utils/parseRound';
import { cn } from '@/lib/utils';

const DEFAULT_SETTINGS = {
  read_aloud: false,
  wpm: 250,
  timed: true,
  buzz_time: 5, // seconds to buzz after Q finishes (5–20)
  powers: false, // house rule: correct interrupt is worth SCORING.TOSSUP_POWER
  boss_ups: false, // house rule: bonuses are read as open tossups
  skip_bonuses: false,
  subjects: [],
  question_types: ['TOSSUP', 'BONUS'],
  display_mode: 'word_by_word', // 'word_by_word' | 'full'
};

// `hideStart` lets a caller own the start button — marathon setups label it
// with the pool size and validate against the pool rather than a chosen round.
export default function GameSettings({ settings = DEFAULT_SETTINGS, onChange, onStart, disabled, hideStart = false, startLabel = 'Start Game' }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  const update = (key, val) => onChange({ ...s, [key]: val });

  const toggleSubject = (subj) => {
    const cur = s.subjects || [];
    update('subjects', cur.includes(subj) ? cur.filter(x => x !== subj) : [...cur, subj]);
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-primary" />
          Game Settings
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Display Mode */}
        <div>
          <Label className="text-sm font-medium mb-2 block">Question Display</Label>
          <Select value={s.display_mode} onValueChange={v => update('display_mode', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="word_by_word">Word-by-word (timed)</SelectItem>
              <SelectItem value="full">Show full question</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* WPM */}
        {s.display_mode === 'word_by_word' && (
          <div>
            <div className="flex justify-between mb-2">
              <Label className="text-sm font-medium flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-primary" /> Reading Speed
              </Label>
              <span className="text-sm font-mono text-primary">{s.wpm} WPM</span>
            </div>
            <Slider
              min={100} max={1000} step={25}
              value={[s.wpm]}
              onValueChange={([v]) => update('wpm', v)}
            />
          </div>
        )}

        {/* Read Aloud */}
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Volume2 className="w-3.5 h-3.5 text-primary" /> Text-to-Speech
          </Label>
          <Switch checked={s.read_aloud} onCheckedChange={v => update('read_aloud', v)} />
        </div>

        {/* Timed / Untimed */}
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-primary" /> Timed Questions
          </Label>
          <Switch checked={s.timed !== false} onCheckedChange={v => update('timed', v)} />
        </div>

        {/* Buzz time (only if timed) */}
        {s.timed !== false && (
          <div>
            <div className="flex justify-between mb-2">
              <Label className="text-sm font-medium text-muted-foreground">Tossup buzz window</Label>
              <span className="text-sm font-mono text-primary">
                {s.buzz_time ?? 5}s <span className="text-muted-foreground text-xs">(bonus +15s)</span>
              </span>
            </div>
            <Slider
              min={5} max={20} step={1}
              value={[s.buzz_time ?? 5]}
              onValueChange={([v]) => update('buzz_time', v)}
            />
          </div>
        )}

        {/* Powers — a house rule, so games using it score as custom games */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-primary" /> Powers
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Correct interrupt is worth +{SCORING.TOSSUP_POWER} instead of +{SCORING.TOSSUP_CORRECT}
              {' '}· posts to the Custom Games leaderboard
            </p>
          </div>
          <Switch checked={!!s.powers} onCheckedChange={v => update('powers', v)} />
        </div>

        {/* Boss-ups — bonuses played as open tossups */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <Label className="text-sm font-medium flex items-center gap-2">
              <Swords className="w-3.5 h-3.5 text-primary" /> Boss-ups
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Bonuses are still read, but as tossups: open to everyone, interrupts and negs
              apply, tossup scoring, +{BOSS_UP_EXTRA_SECONDS}s to buzz
            </p>
          </div>
          <Switch checked={!!s.boss_ups} onCheckedChange={v => update('boss_ups', v)} />
        </div>

        {/* Skip Bonuses — nothing to skip once bonuses are being played as boss-ups */}
        <div className="flex items-center justify-between">
          <Label className={cn('text-sm font-medium', s.boss_ups && 'text-muted-foreground')}>
            Skip Bonus Questions
            {s.boss_ups && <span className="font-normal"> · off while boss-ups are on</span>}
          </Label>
          <Switch
            checked={!s.boss_ups && s.skip_bonuses}
            disabled={!!s.boss_ups}
            onCheckedChange={v => update('skip_bonuses', v)}
          />
        </div>

        {/* Subject Filter */}
        <div>
          <Label className="text-sm font-medium mb-2 block">
            Subject Filter <span className="text-muted-foreground font-normal">(empty = all)</span>
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {SUBJECTS.map(subj => (
              <Badge
                key={subj}
                variant={s.subjects?.includes(subj) ? 'default' : 'outline'}
                className="cursor-pointer select-none text-xs hover:opacity-80 transition-opacity"
                onClick={() => toggleSubject(subj)}
              >
                {subj}
              </Badge>
            ))}
          </div>
        </div>

        {!hideStart && (
          <Button onClick={onStart} className="w-full" disabled={disabled}>
            {startLabel}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}