import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { SUBJECTS, SUBJECT_COLORS } from '@/utils/parseRound';
import { Plus, Trash2, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const EMPTY_QUESTION = () => ({
  _tempId: Math.random().toString(36).slice(2),
  number: 1,
  type: 'TOSSUP',
  subject: 'Biology',
  format: 'Multiple Choice',
  question_text: '',
  choices: { W: '', X: '', Y: '', Z: '' },
  answer: '',
  answer_alternates: [],
  question_set: '',
});

function QuestionRow({ q, index, onChange, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const isMC = q.format === 'Multiple Choice';

  const update = (key, val) => onChange({ ...q, [key]: val });
  const updateChoice = (letter, val) => onChange({ ...q, choices: { ...q.choices, [letter]: val } });

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Row header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-card cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <span className="text-xs font-mono text-muted-foreground w-6">{index + 1}</span>
        <Badge variant={q.type === 'TOSSUP' ? 'default' : 'secondary'} className="text-xs shrink-0">{q.type}</Badge>
        <Badge variant="outline" className={cn('text-xs shrink-0', SUBJECT_COLORS[q.subject] || '')}>{q.subject}</Badge>
        <Badge variant="outline" className="text-xs shrink-0">{q.format}</Badge>
        <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{q.question_text || <span className="italic opacity-50">No text</span>}</span>
        <Button
          size="icon"
          variant="ghost"
          className="w-6 h-6 text-destructive hover:bg-destructive/10 shrink-0"
          onClick={e => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="p-4 border-t border-border space-y-3 bg-muted/20">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <Label className="text-xs mb-1 block">Set #</Label>
              <Input type="number" value={q.number} onChange={e => update('number', parseInt(e.target.value) || 1)} className="h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Type</Label>
              <Select value={q.type} onValueChange={v => update('type', v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="TOSSUP">TOSSUP</SelectItem>
                  <SelectItem value="BONUS">BONUS</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Subject</Label>
              <Select value={q.subject} onValueChange={v => update('subject', v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SUBJECTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">Format</Label>
              <Select value={q.format} onValueChange={v => update('format', v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Multiple Choice">Multiple Choice</SelectItem>
                  <SelectItem value="Short Answer">Short Answer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1 block">Question Text</Label>
            <Textarea
              value={q.question_text}
              onChange={e => update('question_text', e.target.value)}
              rows={3}
              className="text-sm resize-none"
            />
          </div>

          {isMC && (
            <div className="grid grid-cols-2 gap-2">
              {['W', 'X', 'Y', 'Z'].map(letter => (
                <div key={letter}>
                  <Label className="text-xs mb-1 block">{letter})</Label>
                  <Input
                    value={q.choices?.[letter] || ''}
                    onChange={e => updateChoice(letter, e.target.value)}
                    className="h-8 text-sm"
                    placeholder={`Choice ${letter}`}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs mb-1 block">Answer {isMC && <span className="text-muted-foreground">(W/X/Y/Z)</span>}</Label>
              <Input
                value={q.answer}
                onChange={e => update('answer', e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Alternate Answers <span className="text-muted-foreground">(separated by |)</span></Label>
              <Input
                value={(q.answer_alternates || []).join(' | ')}
                onChange={e => update('answer_alternates', e.target.value.split('|').map(s => s.trim()).filter(Boolean))}
                className="h-8 text-sm"
                placeholder="alt1 | alt2…"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// `createPublic` — publish a newly created set to the shared library. Only
// admins can pass this; the server rejects it otherwise (server/rounds.js).
export default function RoundEditor({ round, onClose, onSaved, createPublic = false }) {
  const [title, setTitle] = useState(round?.title || '');
  const [source, setSource] = useState(round?.source || '');
  const [year, setYear] = useState(round?.year || '');
  const [questions, setQuestions] = useState(
    (round?.questions || []).map(q => ({ ...q, _tempId: Math.random().toString(36).slice(2) }))
  );
  const [saving, setSaving] = useState(false);

  const addQuestion = () => {
    const lastNum = questions.reduce((max, q) => Math.max(max, q.number || 0), 0);
    setQuestions(qs => [...qs, { ...EMPTY_QUESTION(), number: lastNum + 1, question_set: round?.title || title }]);
  };

  const updateQuestion = (index, updated) => {
    setQuestions(qs => qs.map((q, i) => i === index ? updated : q));
  };

  const deleteQuestion = (index) => {
    setQuestions(qs => qs.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    const cleaned = questions.map(({ _tempId, ...q }) => q);
    try {
    if (round?.id) {
      await base44.entities.Round.update(round.id, {
        title, source, year,
        questions: cleaned,
        question_count: cleaned.length,
      });
      toast.success('Round saved');
    } else {
      await base44.entities.Round.create({
        title, source, year,
        questions: cleaned,
        question_count: cleaned.length,
        parse_status: 'success',
        // Private unless the caller is an admin who asked to publish — the
        // server rejects a public write from a player either way.
        is_public: Boolean(createPublic),
        file_name: title,
        file_url: '',
        file_type: 'docx',
      });
      toast.success(createPublic ? 'Question set published' : 'Question set created (private)');
    }
    } catch (err) {
      // Most likely a player trying to publish — surface the server's reason.
      toast.error(err.message || 'Could not save this question set');
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved?.();
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{round?.id ? 'Edit Round' : 'Create Question Set'}</DialogTitle>
        </DialogHeader>

        {/* Metadata */}
        <div className="grid grid-cols-3 gap-3 shrink-0">
          <div className="col-span-3 sm:col-span-1">
            <Label className="text-xs mb-1 block">Title *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Round name" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Source / Tournament</Label>
            <Input value={source} onChange={e => setSource(e.target.value)} placeholder="e.g. NSB" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Year</Label>
            <Input value={year} onChange={e => setYear(e.target.value)} placeholder="e.g. 2024" />
          </div>
        </div>

        {/* Questions list */}
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0 pr-1">
          {questions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No questions yet. Add one below.</p>
          )}
          {questions.map((q, i) => (
            <QuestionRow
              key={q._tempId}
              q={q}
              index={i}
              onChange={updated => updateQuestion(i, updated)}
              onDelete={() => deleteQuestion(i)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex gap-2 shrink-0 pt-2 border-t border-border">
          <Button variant="outline" onClick={addQuestion} className="flex-1">
            <Plus className="w-4 h-4 mr-1" /> Add Question
          </Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            <Save className="w-4 h-4 mr-1" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}