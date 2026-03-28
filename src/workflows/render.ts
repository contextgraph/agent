const DEFAULT_WIDTH = 88;
const MIN_WIDTH = 40;

function terminalWidth(): number {
  const columns = process.stdout.columns;
  if (!columns || !Number.isFinite(columns)) {
    return DEFAULT_WIDTH;
  }
  return Math.max(MIN_WIDTH, columns);
}

export function wrapText(text: string, options: { indent?: string; width?: number } = {}): string[] {
  const indent = options.indent ?? '';
  const width = Math.max(MIN_WIDTH, options.width ?? terminalWidth());
  const contentWidth = Math.max(20, width - indent.length);
  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }

    let line = '';
    for (const word of words) {
      if (line.length === 0) {
        line = word;
        continue;
      }
      if (`${line} ${word}`.length <= contentWidth) {
        line += ` ${word}`;
        continue;
      }
      lines.push(`${indent}${line}`);
      line = word;
    }

    if (line.length > 0) {
      lines.push(`${indent}${line}`);
    }
  }

  return lines;
}

export function printWrapped(text: string, options: { indent?: string; width?: number } = {}): void {
  for (const line of wrapText(text, options)) {
    console.log(line);
  }
}
