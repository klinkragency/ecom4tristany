import Link from 'next/link';
import { FileText, ListTree, Newspaper, Database, ImageIcon, ArrowRight, type LucideIcon } from 'lucide-react';

const sections: { href: string; title: string; sub: string; icon: LucideIcon }[] = [
  { href: '/content/pages', title: 'Pages', sub: 'About, FAQ, legal…', icon: FileText },
  { href: '/content/menus', title: 'Navigation menus', sub: 'Header and footer links', icon: ListTree },
  { href: '/content/blog', title: 'Blog', sub: 'Posts, tags, RSS', icon: Newspaper },
  { href: '/content/metaobjects', title: 'Metaobjects', sub: 'Custom content types (FAQs, team, locations…)', icon: Database },
  { href: '/content/files', title: 'Files', sub: 'Images, PDFs and other assets', icon: ImageIcon },
];

export default function ContentPage() {
  return (
    <section className="max-w-4xl">
      <h1 className="h-page mb-5">Content</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {sections.map((s) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.href}
              href={s.href}
              className="card card-pad group flex items-start gap-3 transition-shadow hover:shadow-md"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-stone-100 text-stone-600 transition-transform group-hover:scale-110">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {s.title}
                  <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
                </div>
                <div className="text-xs text-stone-500">{s.sub}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
