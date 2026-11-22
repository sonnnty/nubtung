type ClassInput = string | false | null | undefined;

const TEXT_SIZES = new Set([
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
]);
const TEXT_ALIGNS = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);
const TEXT_WRAPS = new Set(['wrap', 'nowrap', 'balance', 'pretty']);
const FONT_WEIGHTS = new Set([
  'thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black',
]);
const DISPLAY_CLASSES = new Set([
  'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'table', 'inline-table',
  'grid', 'inline-grid', 'contents', 'list-item', 'hidden',
]);
const WHITESPACE_CLASSES = new Set([
  'whitespace-normal', 'whitespace-nowrap', 'whitespace-pre', 'whitespace-pre-line',
  'whitespace-pre-wrap', 'whitespace-break-spaces',
]);
const BG_NON_COLOR_PREFIXES = [
  'clip-', 'origin-', 'gradient-', 'linear-', 'radial-', 'conic-',
];
const BG_NON_COLOR_EXACT = new Set([
  'none', 'repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'repeat-round', 'repeat-space',
  'cover', 'contain', 'auto', 'center', 'top', 'bottom', 'left', 'right',
  'fixed', 'local', 'scroll',
]);
const BORDER_STYLES = new Set(['solid', 'dashed', 'dotted', 'double', 'hidden', 'none']);
const BORDER_WIDTH_VALUES = new Set(['', '0', '2', '4', '8']);

function splitVariantPrefix(token: string): { prefix: string; utility: string } {
  let depth = 0;
  let lastColon = -1;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ':' && depth === 0) lastColon = i;
  }
  if (lastColon === -1) return { prefix: '', utility: token };
  return {
    prefix: token.slice(0, lastColon + 1),
    utility: token.slice(lastColon + 1),
  };
}

function getConflictKeys(utility: string): { key: string; clears?: string[] } | null {
  if (DISPLAY_CLASSES.has(utility)) return { key: 'display' };
  if (WHITESPACE_CLASSES.has(utility)) return { key: 'whitespace' };

  if (utility.startsWith('w-')) return { key: 'w' };
  if (utility.startsWith('min-w-')) return { key: 'min-w' };
  if (utility.startsWith('max-w-')) return { key: 'max-w' };
  if (utility.startsWith('h-')) return { key: 'h' };
  if (utility.startsWith('min-h-')) return { key: 'min-h' };
  if (utility.startsWith('max-h-')) return { key: 'max-h' };

  if (utility.startsWith('p-')) {
    return { key: 'p', clears: ['px', 'py', 'pt', 'pr', 'pb', 'pl'] };
  }
  if (utility.startsWith('px-')) return { key: 'px', clears: ['pl', 'pr'] };
  if (utility.startsWith('py-')) return { key: 'py', clears: ['pt', 'pb'] };
  if (utility.startsWith('pt-')) return { key: 'pt' };
  if (utility.startsWith('pr-')) return { key: 'pr' };
  if (utility.startsWith('pb-')) return { key: 'pb' };
  if (utility.startsWith('pl-')) return { key: 'pl' };

  if (utility.startsWith('leading-')) return { key: 'leading' };
  if (utility.startsWith('rounded-') || utility === 'rounded') return { key: 'rounded' };

  if (utility.startsWith('font-')) {
    const sub = utility.slice(5);
    if (FONT_WEIGHTS.has(sub)) return { key: 'font-weight' };
    return null;
  }

  if (utility.startsWith('text-')) {
    const sub = utility.slice(5);
    if (TEXT_SIZES.has(sub) || (sub.startsWith('[') && /(px|rem|em)\]$/.test(sub))) {
      return { key: 'text-size' };
    }
    if (TEXT_ALIGNS.has(sub)) return { key: 'text-align' };
    if (TEXT_WRAPS.has(sub)) return { key: 'text-wrap' };
    if (sub === 'ellipsis' || sub === 'clip') return { key: 'text-overflow' };
    return { key: 'text-color' };
  }

  if (utility.startsWith('bg-')) {
    const sub = utility.slice(3);
    if (BG_NON_COLOR_EXACT.has(sub) || BG_NON_COLOR_PREFIXES.some((p) => sub.startsWith(p))) {
      return null;
    }
    return { key: 'bg-color' };
  }

  if (utility === 'border' || utility.startsWith('border-')) {
    const sub = utility === 'border' ? '' : utility.slice(7);
    if (BORDER_WIDTH_VALUES.has(sub)) return { key: 'border-w' };
    if (BORDER_STYLES.has(sub)) return { key: 'border-style' };
    if (sub === 'collapse' || sub === 'separate') return { key: 'border-collapse' };
    const sideMatch = sub.match(/^(t|r|b|l|x|y)(?:-(.*))?$/);
    if (sideMatch) {
      const side = sideMatch[1];
      const rest = sideMatch[2] ?? '';
      if (BORDER_WIDTH_VALUES.has(rest)) return { key: `border-${side}-w` };
      return { key: `border-${side}-color` };
    }
    return { key: 'border-color' };
  }

  return null;
}

/**
 * Merge Tailwind class strings while resolving conflicts for common layout, sizing,
 * spacing, typography, and color utilities so component `className` overrides win.
 */
export function cn(...inputs: ClassInput[]): string {
  const tokens: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    for (const part of input.trim().split(/\s+/)) {
      if (part) tokens.push(part);
    }
  }

  const kept: Array<string | null> = [];
  const latestByGroup = new Map<string, number>();

  for (const token of tokens) {
    const { prefix, utility } = splitVariantPrefix(token);
    const conflict = getConflictKeys(utility);
    if (conflict) {
      const groupKey = `${prefix}${conflict.key}`;
      const prevIdx = latestByGroup.get(groupKey);
      if (prevIdx !== undefined) kept[prevIdx] = null;

      if (conflict.clears) {
        for (const c of conflict.clears) {
          const clearKey = `${prefix}${c}`;
          const clearIdx = latestByGroup.get(clearKey);
          if (clearIdx !== undefined) {
            kept[clearIdx] = null;
            latestByGroup.delete(clearKey);
          }
        }
      }
      latestByGroup.set(groupKey, kept.length);
    }
    kept.push(token);
  }

  return kept.filter(Boolean).join(' ');
}
