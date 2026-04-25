export default function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <section>
      <h1 className="h-page mb-2">{title}</h1>
      <p className="text-stone-500">Coming in {phase}.</p>
    </section>
  );
}
