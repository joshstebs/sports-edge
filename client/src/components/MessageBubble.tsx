export default function MessageBubble({
  content,
  images,
}: {
  content: string;
  images?: string[];
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-gradient-to-br from-edge to-edge2 px-4 py-2.5 text-sm font-semibold leading-relaxed text-ink shadow-[0_4px_20px_rgba(21,255,194,0.2)]">
        {images && images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`attachment ${i + 1}`}
                className="h-24 w-24 rounded-lg object-cover ring-1 ring-ink/20"
              />
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}
