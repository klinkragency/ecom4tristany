export default function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold mb-2">{title}</h1>
      <p className="text-[color:var(--color-text-muted)]">Coming in {phase}.</p>
    </section>
  );
}
