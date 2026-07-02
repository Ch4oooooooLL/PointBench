export const DEFAULT_STRESS_FORMULA = '(max-min)*0.21';

type Token =
  | { type: 'number'; value: number }
  | { type: 'name'; value: 'max' | 'min' }
  | { type: 'operator'; value: '+' | '-' | '*' | '/' }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'eof' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const match = input.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
      if (!match) throw new Error('Invalid number');
      tokens.push({ type: 'number', value: Number(match[0]) });
      index += match[0].length;
      continue;
    }

    if (input.startsWith('max', index)) {
      tokens.push({ type: 'name', value: 'max' });
      index += 3;
      continue;
    }

    if (input.startsWith('min', index)) {
      tokens.push({ type: 'name', value: 'min' });
      index += 3;
      continue;
    }

    if (char === '+' || char === '-' || char === '*' || char === '/') {
      tokens.push({ type: 'operator', value: char });
      index += 1;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      index += 1;
      continue;
    }

    throw new Error('Invalid token');
  }

  tokens.push({ type: 'eof' });
  return tokens;
}

export function evaluateStressFormula(formula: string, max: number, min: number): number | null {
  let tokens: Token[];
  try {
    tokens = tokenize(formula || DEFAULT_STRESS_FORMULA);
  } catch {
    return null;
  }
  let index = 0;

  function current(): Token {
    return tokens[index];
  }

  function consume(): Token {
    const token = current();
    index += 1;
    return token;
  }

  function parseExpression(): number {
    let value = parseTerm();
    while (true) {
      const token = current();
      if (token.type !== 'operator' || (token.value !== '+' && token.value !== '-')) break;
      const operator = token.value;
      consume();
      const right = parseTerm();
      value = operator === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (true) {
      const token = current();
      if (token.type !== 'operator' || (token.value !== '*' && token.value !== '/')) break;
      const operator = token.value;
      consume();
      const right = parseFactor();
      if (operator === '/' && right === 0) throw new Error('Division by zero');
      value = operator === '*' ? value * right : value / right;
    }
    return value;
  }

  function parseFactor(): number {
    const token = current();
    if (token.type === 'operator' && (token.value === '-' || token.value === '+')) {
      consume();
      const value = parseFactor();
      return token.value === '-' ? -value : value;
    }
    if (token.type === 'number') {
      consume();
      return token.value;
    }
    if (token.type === 'name') {
      consume();
      return token.value === 'max' ? max : min;
    }
    if (token.type === 'paren' && token.value === '(') {
      consume();
      const value = parseExpression();
      const close = current();
      if (close.type !== 'paren' || close.value !== ')') throw new Error('Unclosed parenthesis');
      consume();
      return value;
    }
    throw new Error('Unexpected token');
  }

  try {
    const value = parseExpression();
    if (current().type !== 'eof' || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function calculateStressPreview(
  max: number | null,
  min: number | null,
  formula: string,
): { amplitude: number; stress: number | null } | null {
  if (max == null || min == null) return null;
  return {
    amplitude: (max - min) / 2,
    stress: evaluateStressFormula(formula, max, min),
  };
}
