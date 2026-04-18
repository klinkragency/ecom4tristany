'use client';

import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect } from 'react';

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
};

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 180 }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? 'Start typing…',
      }),
    ],
    content: value || '',
    editorProps: {
      attributes: {
        class: 'tiptap-editor focus:outline-none px-3 py-2 rounded border border-[color:var(--color-border)] bg-white text-sm',
        style: `min-height:${minHeight}px`,
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      // Tiptap emits '<p></p>' for empty — normalize to ''.
      onChange(html === '<p></p>' ? '' : html);
    },
    // Required in Next.js App Router to avoid SSR hydration mismatches.
    immediatelyRender: false,
  });

  // Keep editor in sync if the parent swaps `value` externally (e.g. on refetch).
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || '';
    if (current === next || (current === '<p></p>' && next === '')) return;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  if (!editor) {
    return (
      <div
        className="rounded border border-[color:var(--color-border)] bg-white px-3 py-2 text-sm text-[color:var(--color-text-muted)]"
        style={{ minHeight }}
      >
        Loading editor…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  function toggleLink() {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('URL (leave empty to remove)', prev ?? 'https://');
    if (url === null) return;
    if (url === '' || url === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Text formatting">
      <TBtn active={editor.isActive('bold')} onRun={() => editor.chain().focus().toggleBold().run()} label="Bold">
        <b>B</b>
      </TBtn>
      <TBtn active={editor.isActive('italic')} onRun={() => editor.chain().focus().toggleItalic().run()} label="Italic">
        <i>I</i>
      </TBtn>
      <TBtn active={editor.isActive('strike')} onRun={() => editor.chain().focus().toggleStrike().run()} label="Strikethrough">
        <s>S</s>
      </TBtn>
      <span className="w-px h-5 bg-[color:var(--color-border)] mx-1" />
      <TBtn
        active={editor.isActive('heading', { level: 2 })}
        onRun={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        label="Heading 2"
      >
        H2
      </TBtn>
      <TBtn
        active={editor.isActive('heading', { level: 3 })}
        onRun={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        label="Heading 3"
      >
        H3
      </TBtn>
      <span className="w-px h-5 bg-[color:var(--color-border)] mx-1" />
      <TBtn active={editor.isActive('bulletList')} onRun={() => editor.chain().focus().toggleBulletList().run()} label="Bullet list">
        • List
      </TBtn>
      <TBtn active={editor.isActive('orderedList')} onRun={() => editor.chain().focus().toggleOrderedList().run()} label="Ordered list">
        1. List
      </TBtn>
      <TBtn active={editor.isActive('blockquote')} onRun={() => editor.chain().focus().toggleBlockquote().run()} label="Blockquote">
        ❝
      </TBtn>
      <span className="w-px h-5 bg-[color:var(--color-border)] mx-1" />
      <TBtn active={editor.isActive('link')} onRun={toggleLink} label="Link">
        Link
      </TBtn>
      <TBtn
        active={false}
        onRun={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        label="Clear formatting"
      >
        Clear
      </TBtn>
    </div>
  );
}

// TBtn wraps a toolbar button with `onMouseDown={preventDefault}` so clicks
// don't steal focus from the editor (which would blow away the user's selection
// before the formatting command runs — the classic Tiptap toolbar gotcha).
function TBtn({
  active,
  onRun,
  label,
  children,
}: {
  active: boolean;
  onRun: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const cls = `px-2 py-1 text-sm rounded border ${
    active
      ? 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]'
      : 'border-[color:var(--color-border)] bg-white hover:bg-gray-50'
  }`;
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
      className={cls}
      aria-label={label}
    >
      {children}
    </button>
  );
}
