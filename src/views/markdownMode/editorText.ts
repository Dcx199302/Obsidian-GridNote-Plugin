export function normalizeEditorText(text: string): string {
    return text.replace(/\r\n?/g, '\n');
}
