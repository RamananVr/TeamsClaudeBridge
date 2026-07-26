export function truncateForTeams(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  const shown = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;
  return `${shown.join('\n')}\n…(${remaining} more lines)`;
}
