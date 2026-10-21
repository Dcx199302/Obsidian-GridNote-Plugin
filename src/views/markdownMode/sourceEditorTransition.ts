import { normalizeEditorText } from './editorText';

export function hasSourceEditorTransitioned(
    currentEditorText: string,
    expectedText: string | null
): boolean {
    // vault 读取可能早于 editor 换装完成；只有内容等于 vault 数据，
    // 才能把 editor 内容视为新文件，避免把上一个文件重新渲染到新 sourcePath。
    return expectedText !== null
        && normalizeEditorText(currentEditorText) === normalizeEditorText(expectedText);
}
