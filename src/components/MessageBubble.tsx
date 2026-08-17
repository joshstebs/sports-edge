export default function MessageBubble({
  content,
  images,
}: {
  content: string;
  images?: string[];
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-xl border border-line bg-panel2 px-3.5 py-2.5 text-[13px] font-medium leading-relaxed text-head shadow-[0_8px_24px_rgba(0,0,0,0.16)] sm:max-w-[80%]">
        {images && images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {images.map((src, i) => (
              <img key={i} src={src} alt={`attachment ${i + 1}`} className="h-24 w-24 rounded-md border border-line object-cover" />
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap">{content}</div>
      </div>
    </div>
  );
}
