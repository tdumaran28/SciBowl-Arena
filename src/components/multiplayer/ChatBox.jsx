import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';

export default function ChatBox({ session, myPlayerId, myDisplayName, onSendMessage }) {
  const [text, setText] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const bottomRef = useRef(null);
  const messages = session?.chat_messages || [];

  useEffect(() => {
    if (!collapsed) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, collapsed]);

  const handleSend = (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    onSendMessage(text.trim());
    setText('');
  };

  return (
    <div className="border border-border rounded-xl bg-card shadow-sm flex flex-col overflow-hidden">
      <button
        className="flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="w-4 h-4 text-primary" />
          Chat
          {messages.length > 0 && (
            <span className="text-xs text-muted-foreground">({messages.length})</span>
          )}
        </div>
        {collapsed ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <>
          <div className="flex-1 overflow-y-auto max-h-40 px-3 py-2 space-y-1.5 bg-muted/20">
            {messages.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">No messages yet — say hi!</p>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex gap-1.5 ${msg.sender_id === myPlayerId ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-2.5 py-1.5 text-xs ${
                    msg.sender_id === myPlayerId
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border border-border'
                  }`}>
                    {msg.sender_id !== myPlayerId && (
                      <p className="font-semibold text-[10px] opacity-70 mb-0.5">{msg.sender_name}</p>
                    )}
                    <p>{msg.text}</p>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          <form onSubmit={handleSend} className="flex gap-1.5 px-3 py-2 border-t border-border bg-card">
            <Input
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Message…"
              className="h-7 text-xs flex-1"
              maxLength={200}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button type="submit" size="sm" className="h-7 px-2" disabled={!text.trim()}>
              <Send className="w-3.5 h-3.5" />
            </Button>
          </form>
        </>
      )}
    </div>
  );
}