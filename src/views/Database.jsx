import { useState, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Upload, Search, BookOpen, CheckCircle, AlertCircle, Loader2, Plus, FileJson, ClipboardPaste, Globe, Lock, Shield } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SUBJECT_COLORS, sortRoundsByNumber } from '@/utils/parseRound';
import { extractTextFromFile } from '@/utils/extractText';
import { parsePacket } from '@/utils/parsePacket';
import { parseJsonPacket } from '@/utils/parseJsonPacket';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import RecentRounds from '@/components/database/RecentRounds';
import SourceBrowser from '@/components/database/SourceBrowser';
import RoundEditor from '@/components/database/RoundEditor';
import { RoundPermissionsProvider } from '@/components/database/RoundPermissions';

export default function Database() {
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('');
  const [previewRound, setPreviewRound] = useState(null);
  const [editRound, setEditRound] = useState(null);
  const [jsonPasteText, setJsonPasteText] = useState('');
  const [jsonPasteLoading, setJsonPasteLoading] = useState(false);
  const [yearFilter, setYearFilter] = useState('all');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const fileInputRef = useRef(null);
  const jsonFileInputRef = useRef(null);
  const qc = useQueryClient();

  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => base44.auth.me(),
    staleTime: 5 * 60 * 1000,
  });
  const isAdmin = me?.role === 'admin';

  // Only public packets and my own private ones come back — the server scopes
  // this by visibility (server/rounds.js).
  const { data: rounds = [], isLoading } = useQuery({
    queryKey: ['rounds'],
    queryFn: () => base44.entities.Round.list('-created_date', 500),
  });

  // Admins publish by default (that's the shared library they curate); players
  // can only ever create private packets, so the control is hidden for them.
  const [publishPublic, setPublishPublic] = useState(false);
  const newRoundIsPublic = isAdmin && publishPublic;

  const availableYears = [...new Set(rounds.map(r => r.year).filter(Boolean))].sort().reverse();
  const availableSubjects = [...new Set(rounds.flatMap(r => (r.questions || []).map(q => q.subject).filter(Boolean)))].sort();

  const filtered = sortRoundsByNumber(rounds.filter(r => {
    const q = r.title?.toLowerCase() || '';
    const src = r.source?.toLowerCase() || '';
    const yr = r.year || '';
    const matchesSearch = q.includes(search.toLowerCase()) || src.includes(search.toLowerCase()) || yr.includes(search);
    const matchesYear = yearFilter === 'all' || r.year === yearFilter;
    const roundSubjects = new Set((r.questions || []).map(qq => qq.subject).filter(Boolean));
    const matchesSubject = subjectFilter === 'all' || roundSubjects.has(subjectFilter);
    return matchesSearch && matchesYear && matchesSubject;
  }));

  const handleFileUpload = async (files) => {
    if (!files?.length) return;
    const file = files[0];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx'].includes(ext)) {
      toast.error('Only PDF and DOCX files are supported');
      return;
    }

    setUploading(true);
    setUploadProgress(10);
    setUploadStatus('Extracting text…');

    const packetName = file.name.replace(/\.[^.]+$/, '');

    try {
      const rawText = await extractTextFromFile(file);
      setUploadProgress(40);
      setUploadStatus('Parsing questions…');

      const questions = parsePacket(rawText, packetName);
      setUploadProgress(70);
      setUploadStatus('Uploading file…');

      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setUploadProgress(85);
      setUploadStatus('Saving round…');

      await base44.entities.Round.create({
        title: packetName,
        source: '',
        year: '',
        file_url,
        file_name: file.name,
        file_type: ext,
        questions,
        question_count: questions.length,
        parse_status: questions.length > 0 ? 'success' : 'error',
        parse_error: questions.length === 0 ? 'No questions found — check file format' : '',
        is_public: newRoundIsPublic,
      });

      setUploadProgress(100);
      setUploadStatus('Done!');
      toast.success(
        `Parsed ${questions.length} questions from "${packetName}"` +
        (newRoundIsPublic ? ' — published to the shared library' : ' — saved as private'),
      );
      qc.invalidateQueries({ queryKey: ['rounds'] });
    } catch (err) {
      toast.error('Failed to parse file: ' + (err.message || 'Unknown error'));
      setUploadStatus('Error');
    } finally {
      setTimeout(() => {
        setUploading(false);
        setUploadProgress(0);
        setUploadStatus('');
      }, 1200);
    }
  };

  const handleJsonImport = async (jsonText) => {
    if (!jsonText?.trim()) {
      toast.error('Please paste or upload a JSON file first');
      return;
    }
    setJsonPasteLoading(true);
    try {
      const { packetName, source, year, questions } = parseJsonPacket(jsonText);
      if (questions.length === 0) {
        toast.error('No questions found in JSON — check the format');
        setJsonPasteLoading(false);
        return;
      }
      await base44.entities.Round.create({
        title: packetName,
        source,
        year,
        file_url: '',
        file_name: packetName + '.json',
        file_type: 'json',
        questions,
        question_count: questions.length,
        parse_status: 'success',
        is_public: newRoundIsPublic,
      });
      toast.success(
        `Imported ${questions.length} questions from "${packetName}"` +
        (newRoundIsPublic ? ' — published to the shared library' : ' — saved as private'),
      );
      qc.invalidateQueries({ queryKey: ['rounds'] });
      setJsonPasteText('');
    } catch (err) {
      toast.error('Failed to parse JSON: ' + (err.message || 'Invalid format'));
    } finally {
      setJsonPasteLoading(false);
    }
  };

  const handleJsonFileUpload = async (files) => {
    if (!files?.length) return;
    const file = files[0];
    if (!file.name.endsWith('.json')) {
      toast.error('Please upload a .json file');
      return;
    }
    const text = await file.text();
    await handleJsonImport(text);
  };

  const handleDelete = async (round) => {
    if (!confirm(`Delete "${round.title}"?`)) return;
    try {
      await base44.entities.Round.delete(round.id);
      qc.invalidateQueries({ queryKey: ['rounds'] });
      toast.success('Round deleted');
    } catch (err) {
      toast.error(err.message || 'Could not delete that packet');
    }
  };

  // Publishing (and un-publishing) is an admin action — the server rejects it
  // for players, so surface the reason rather than a bare failure.
  const toggleVisibility = async (round) => {
    try {
      await base44.entities.Round.update(round.id, { is_public: !round.is_public });
      qc.invalidateQueries({ queryKey: ['rounds'] });
      toast.success(round.is_public ? 'Packet is now private' : 'Packet published to the shared library');
    } catch (err) {
      toast.error(err.message || 'Could not change visibility');
    }
  };

  return (
    <RoundPermissionsProvider user={me}>
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Round Library</h1>
          <p className="text-muted-foreground">
            Upload and browse Science Bowl packets
            {isAdmin
              ? ' — you can publish to the shared library'
              : ' — your uploads are private to you'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isAdmin ? 'default' : 'secondary'} className="text-xs">
            {isAdmin ? <><Shield className="w-3 h-3 mr-1" /> Admin</> : 'Player'}
          </Badge>
          <Button onClick={() => setEditRound('new')} variant="outline">
            <Plus className="w-4 h-4 mr-2" /> Create Question Set
          </Button>
        </div>
      </div>

      {/* Visibility of anything created here */}
      <Card className="mb-4 border-border/60">
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            {newRoundIsPublic
              ? <Globe className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              : <Lock className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
            <div className="min-w-0">
              <p className="text-sm font-medium">
                New packets are {newRoundIsPublic ? 'public' : 'private'}
              </p>
              <p className="text-xs text-muted-foreground">
                {newRoundIsPublic
                  ? 'Listed in the shared library for everyone'
                  : 'Only you see them here — they are still playable by everyone in a multiplayer room you host'}
              </p>
            </div>
          </div>
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Publish</span>
              <Switch checked={publishPublic} onCheckedChange={setPublishPublic} />
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Only admins can publish</span>
          )}
        </CardContent>
      </Card>

      {/* Upload zone */}
      <Card className="mb-6">
        <CardContent className="p-0">
          <Tabs defaultValue="file" className="w-full">
            <TabsList className="w-full rounded-b-none border-b border-border rounded-t-lg h-auto p-0 bg-muted/40">
              <TabsTrigger value="file" className="flex-1 rounded-none rounded-tl-lg py-2.5 text-sm gap-2">
                <Upload className="w-3.5 h-3.5" /> PDF / DOCX
              </TabsTrigger>
              <TabsTrigger value="json" className="flex-1 rounded-none rounded-tr-lg py-2.5 text-sm gap-2">
                <FileJson className="w-3.5 h-3.5" /> JSON Import
              </TabsTrigger>
            </TabsList>

            {/* PDF/DOCX tab */}
            <TabsContent value="file" className="m-0">
              <div className="p-8 text-center border-dashed border-2 border-primary/20 rounded-b-lg bg-primary/5 hover:bg-primary/10 transition-colors mx-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={e => handleFileUpload(e.target.files)}
                />
                {uploading ? (
                  <div className="max-w-xs mx-auto">
                    <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-3" />
                    <p className="font-medium mb-2">{uploadStatus}</p>
                    <Progress value={uploadProgress} className="h-2" />
                  </div>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-primary/60 mx-auto mb-3" />
                    <p className="font-semibold text-lg mb-1">Upload a Science Bowl Packet</p>
                    <p className="text-muted-foreground text-sm mb-4">PDF or DOCX · Questions parsed automatically</p>
                    <Button onClick={() => fileInputRef.current?.click()}>
                      <Upload className="w-4 h-4 mr-2" /> Choose File
                    </Button>
                  </>
                )}
              </div>
            </TabsContent>

            {/* JSON tab */}
            <TabsContent value="json" className="m-0 p-6">
              <input
                ref={jsonFileInputRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={e => handleJsonFileUpload(e.target.files)}
              />
              <div className="flex items-start gap-3 mb-4">
                <FileJson className="w-8 h-8 text-primary/60 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold mb-0.5">Import from JSON</p>
                  <p className="text-muted-foreground text-sm">
                    Upload a <code className="bg-muted px-1 rounded text-xs">.json</code> file or paste JSON text below.
                    Must follow the SciBowl Arena JSON format.
                  </p>
                </div>
              </div>
              <textarea
                className="w-full h-40 rounded-lg border border-border bg-muted/40 p-3 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
                placeholder={`{\n  "set_name": "NSB 2024",\n  "set_round": "Round 1",\n  "set_year": "2024",\n  "questions": [\n    {\n      "question_number": "1",\n      "toss_bonus": "toss-up",\n      "subject": "Biology",\n      "question_type": "Short Answer",\n      "question_text": "...",\n      "answer": "...",\n      "answer_variations": []\n    }\n  ]\n}`}
                value={jsonPasteText}
                onChange={e => setJsonPasteText(e.target.value)}
              />
              <div className="flex gap-2 mt-3">
                <Button
                  variant="outline"
                  onClick={() => jsonFileInputRef.current?.click()}
                  disabled={jsonPasteLoading}
                >
                  <FileJson className="w-4 h-4 mr-2" /> Upload .json File
                </Button>
                <Button
                  onClick={() => handleJsonImport(jsonPasteText)}
                  disabled={jsonPasteLoading || !jsonPasteText.trim()}
                >
                  {jsonPasteLoading
                    ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing…</>
                    : <><ClipboardPaste className="w-4 h-4 mr-2" /> Import Pasted JSON</>}
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Search & filters */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, source, year…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Years</SelectItem>
            {availableYears.map(y => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={subjectFilter} onValueChange={setSubjectFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Subject" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Subjects</SelectItem>
            {availableSubjects.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="text-sm">{filtered.length} rounds</Badge>
      </div>

      {/* Round list — two columns: recent uploads + collapsible source browser */}
      {isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2.5">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse border-border/60">
                <CardContent className="p-3.5">
                  <div className="h-4 bg-muted rounded w-3/4 mb-2" />
                  <div className="h-3 bg-muted rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="lg:col-span-2 space-y-2">
            {[...Array(4)].map((_, i) => (
              <Card key={i} className="animate-pulse border-border/60">
                <CardContent className="p-3.5">
                  <div className="h-4 bg-muted rounded w-1/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No rounds found</p>
          <p className="text-sm">Upload a Science Bowl packet to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <RecentRounds rounds={filtered} onPreview={setPreviewRound} />
          <div className="lg:col-span-2">
            <SourceBrowser
              rounds={filtered}
              onPreview={setPreviewRound}
              onEdit={setEditRound}
              onDelete={handleDelete}
              onToggleVisibility={toggleVisibility}

            />
          </div>
        </div>
      )}

      {/* Round Editor */}
      {editRound && (
        <RoundEditor
          round={editRound === 'new' ? null : editRound}
          createPublic={newRoundIsPublic}
          onClose={() => setEditRound(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['rounds'] })}
        />
      )}

      {/* Preview Dialog */}
      <Dialog open={!!previewRound} onOpenChange={() => setPreviewRound(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{previewRound?.title}</DialogTitle>
            <DialogDescription>{previewRound?.question_count} questions · {previewRound?.source}</DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 space-y-3 pr-2">
            {(previewRound?.questions || []).slice(0, 20).map((q, i) => (
              <div key={i} className="border border-border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground">#{q.number}</span>
                  <Badge variant={q.type === 'TOSSUP' ? 'default' : 'secondary'} className="text-xs">{q.type}</Badge>
                  <Badge variant="outline" className={`text-xs ${SUBJECT_COLORS[q.subject] || ''}`}>{q.subject}</Badge>
                  <Badge variant="outline" className="text-xs">{q.format}</Badge>
                  {q.question_set && <span className="text-xs text-muted-foreground ml-auto truncate max-w-[140px]">{q.question_set}</span>}
                </div>
                <p className="text-sm">{q.question_text}</p>
                {q.choices && (
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    {['W', 'X', 'Y', 'Z'].map(k => q.choices[k] && (
                      <div key={k} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{k})</span> {q.choices[k]}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mt-2">Answer: {q.answer}</p>
              </div>
            ))}
            {previewRound?.questions?.length > 20 && (
              <p className="text-sm text-muted-foreground text-center py-2">+{previewRound.questions.length - 20} more questions</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </RoundPermissionsProvider>
  );
}

function StatusBadge({ status }) {
  if (status === 'success') return <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />;
  if (status === 'error') return <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0" />;
  if (status === 'processing') return <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />;
  return null;
}

function getSubjectCounts(questions = []) {
  const counts = {};
  questions.forEach(q => {
    const s = q.subject || 'General Science';
    counts[s] = (counts[s] || 0) + 1;
  });
  return Object.entries(counts).sort(([, a], [, b]) => b - a);
}