import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../types';
import AssistantMessage from './AssistantMessage';
import EmptyState from './EmptyState';
import MessageBubble from './MessageBubble';

interface MessageListProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onRetry: (assistantId: string) => void;
}

export default function MessageList({ messages, onSend, onRetry }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest content in view while deltas stream in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmptyState onPick={onSend} />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        {messages.map((m) =>
          m.role === 'user' ? (
            <MessageBubble key={m.id} content={m.content} />
          ) : (
            <AssistantMessage key={m.id} message={m} onRetry={onRetry} />
          ),
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
