import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sortRoundsByNumber } from '@/utils/parseRound';

// Round picker grouped by competition/source → year → rounds (by number).
export default function RoundSelect({ rounds, value, onChange, placeholder = 'Choose a round…' }) {
  const sorted = sortRoundsByNumber(rounds);
  const groups = [];
  const map = {};
  sorted.forEach(r => {
    const src = r.source?.trim() || 'Uncategorized';
    const yr = r.year?.trim() || 'Unknown year';
    const key = `${src}\u0000${yr}`;
    if (!map[key]) { map[key] = { source: src, year: yr, rounds: [] }; groups.push(map[key]); }
    map[key].rounds.push(r);
  });
  groups.sort((a, b) => a.source.localeCompare(b.source) || String(b.year).localeCompare(String(a.year)));

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {groups.map(g => (
          <SelectGroup key={`${g.source}|${g.year}`}>
            <SelectLabel className="text-xs text-muted-foreground font-semibold">{g.source} — {g.year}</SelectLabel>
            {g.rounds.map(r => (
              <SelectItem key={r.id} value={r.id}>{r.title} ({r.question_count || 0} Q)</SelectItem>
            ))}
          </SelectGroup>
        ))}
        {groups.length === 0 && <SelectItem value="__none" disabled>No rounds available</SelectItem>}
      </SelectContent>
    </Select>
  );
}