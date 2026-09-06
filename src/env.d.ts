/** pty_helper.py is bundled as text by esbuild's `.py: text` loader. */
declare module '*.py' {
    const content: string;
    export default content;
}
