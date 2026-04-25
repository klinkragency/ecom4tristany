export default function Loading() {
  return (
    <div className="flex items-center gap-3 text-sm text-stone-500" aria-busy="true">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stone-400 opacity-50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-stone-500" />
      </span>
      Loading…
    </div>
  );
}
