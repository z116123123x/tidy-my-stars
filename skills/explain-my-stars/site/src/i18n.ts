export function isTraditionalChinese(locale: string): boolean {
  return /^zh(?:-(?:hant|tw|hk|mo))(?:-|$)/i.test(locale);
}

export function uiText(locale: string, english: string, traditionalChinese: string): string {
  return isTraditionalChinese(locale) ? traditionalChinese : english;
}

export function commandShortcutLabel(platform = typeof navigator === 'undefined' ? '' : navigator.platform): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? '⌘K' : 'Ctrl+K';
}
