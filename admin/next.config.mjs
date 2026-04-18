/** @type {import('next').NextConfig} */
const config = {
  // Disabled because Tiptap's editor instance gets confused by StrictMode's
  // double-mount in dev — toolbar buttons end up pointing at a stale editor.
  reactStrictMode: false,
};
export default config;
