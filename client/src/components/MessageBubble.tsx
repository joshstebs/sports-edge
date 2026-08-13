export default function MessageBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-gradient-to-br from-edge to-edge2 px-4 py-2.5 text-sm font-semibold leading-relaxed text-ink shadow-[0_4px_20px_rgba(21,255,194,0.2)]">
        {content}
      </div>
    </div>
  );
}
