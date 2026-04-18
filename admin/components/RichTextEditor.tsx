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
        class:
          'prose prose-sm max-w-none focus:outline-none px-3 py-2 rounded border border-[color:var(--color-border)] bg-white',
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
  const btn = (active: boolean) =>
    `px-2 py-1 text-sm rounded border ${
      active
        ? 'bg-[color:var(--color-accent)] text-white border-[color:var(--color-accent)]'
        : 'border-[color:var(--color-border)] bg-white hover:bg-gray-50'
    }`;

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
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={btn(editor.isActive('bold'))}
        aria-label="Bold"
      >
        <b>B</b>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={btn(editor.isActive('italic'))}
        aria-label="Italic"
      >
        <i>I</i>
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={btn(editor.isActive('strike'))}
        aria-label="Strikethrough"
      >
        <s>S</s>
      </button>
      <span className="w-px h-5 bg-[color:var(--color-border)] mx-1" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        className={btn(editor.isActive('heading', { level: 2 }))}
        aria-label="Heading 2"
      >
        H2
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        className={btn(editor.isActive('heading', { level: 3 }))}
        aria-label="Heading 3"
      >
        H3
      </button>
      <span className="w-px h-5 bg-[color:var(--color-border)] mx-1" />
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={btn(editor.isActive('bulletList'))}
        aria-label="Bullet list"
      >
        • List
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={btn(editor.isActive('orderedList'))}
        aria-label="Ordered list"
      >
        1. List
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={btn(editor.isActive('blockquote'))}
        aria-label="Blockquote"
      >
        ❝
      </button>
      <span className="w-px h-5 bg-[color:var(--color-border)] mx-1" />
      <button type="button" onClick={toggleLink} className={btn(editor.isActive('link'))} aria-label="Link">
        Link
      </button>
      <button
        type="button"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        className={btn(false)}
        aria-label="Clear formatting"
      >
        Clear
      </button>
    </div>
  );
}
