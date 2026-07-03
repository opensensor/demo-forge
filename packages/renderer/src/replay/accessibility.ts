/**
 * DemoForge renderer — accessibility diff.
 *
 * Computes a diff between two AX (accessibility) snapshots to show what
 * changed on the page. Used for failure output to help diagnose issues.
 */

/**
 * Compute a simple text diff between two AX snapshots.
 *
 * @param before - AX snapshot before the change
 * @param after - AX snapshot after the change
 * @returns Formatted diff string, or empty string if identical
 */
export function accessibilityDiff(before: string, after: string): string {
  if (before === after) {
    return '';
  }

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  const diffParts: string[] = [];

  diffParts.push('--- before');
  diffParts.push('+++ after');
  diffParts.push('');

  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    const beforeLine = beforeLines[i] ?? '';
    const afterLine = afterLines[i] ?? '';

    if (beforeLine === afterLine) {
      diffParts.push(` ${beforeLine}`);
    } else {
      if (beforeLine) {
        diffParts.push(`- ${beforeLine}`);
      }
      if (afterLine) {
        diffParts.push(`+ ${afterLine}`);
      }
    }
  }

  return diffParts.join('\n');
}
