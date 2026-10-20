// DESIGN.md › Enforcement: JSX/JS outside src/lib/ and src/styles/ holds no
// colour, font or radius literal. Colours, fonts and radii come from
// src/styles/tokens.css as var(--…). Document content (stamp colours, the
// user's own colours and fonts) lives in src/lib/ and is passed through.
//
// Parses each file (so comments and identifiers can't trip it) and fails on
//   - a hex, rgb()/rgba() or hsl()/hsla() colour in any string or JSX text
//   - a quoted value for fontFamily / font (style objects, SVG attributes)
//   - a numeric or non-var() value for borderRadius
//
//   npm run check:literals              check src/
//   node scripts/check-literals.mjs <dir|file>…

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const root = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = [join(root, 'src', 'lib'), join(root, 'src', 'styles')];
const targets = process.argv.length > 2 ? process.argv.slice(2) : [join(root, 'src')];

const HEX = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;
const COLOUR_FN = /\b(?:rgba?|hsla?)\(/i;
const FONT_KEYS = new Set(['fontFamily', 'font', 'font-family']);
const RADIUS_KEYS = new Set(['borderRadius', 'border-radius']);
const isVar = (text) => /^\s*var\(--[\w-]+\)\s*$/.test(text);

function files(path) {
  if (SKIP_DIRS.some((dir) => path === dir || path.startsWith(dir + sep))) return [];
  if (statSync(path).isDirectory()) return readdirSync(path).flatMap((name) => files(join(path, name)));
  return /\.(jsx?|mjs)$/.test(path) ? [path] : [];
}

/** Literal leaves a value expression can evaluate to (through ?:, ||, {…}). */
function leaves(node) {
  if (!node) return [];
  switch (node.type) {
    case 'JSXExpressionContainer':
      return leaves(node.expression);
    case 'ConditionalExpression':
      return [...leaves(node.consequent), ...leaves(node.alternate)];
    case 'LogicalExpression':
      return [...leaves(node.left), ...leaves(node.right)];
    case 'StringLiteral':
    case 'NumericLiteral':
    case 'TemplateLiteral':
      return [node];
    default:
      return [];
  }
}

const textOf = (node) =>
  node.type === 'TemplateLiteral' ? node.quasis.map((q) => q.value.cooked).join('${…}') : String(node.value);

function keyName(node) {
  if (node.type === 'ObjectProperty') {
    const { key } = node;
    return key.type === 'Identifier' ? key.name : key.type === 'StringLiteral' ? key.value : null;
  }
  if (node.type === 'JSXAttribute') return node.name.name;
  return null;
}

function check(file) {
  const code = readFileSync(file, 'utf8');
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'], errorRecovery: false });
  const problems = [];
  const report = (node, message) =>
    problems.push(`${relative(root, file)}:${node.loc.start.line}:${node.loc.start.column + 1}  ${message}`);

  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;

    // Colours, anywhere a string can carry one.
    const text =
      node.type === 'StringLiteral' || node.type === 'JSXText'
        ? node.value
        : node.type === 'TemplateElement'
          ? node.value.cooked
          : null;
    if (text != null && (HEX.test(text) || COLOUR_FN.test(text))) {
      report(node, `colour literal ${JSON.stringify((text.match(HEX) ?? text.match(COLOUR_FN))[0])}: use a var(--…) token`);
    }

    const key = keyName(node);
    const value = node.value;
    if (key && FONT_KEYS.has(key)) {
      for (const leaf of leaves(value)) {
        const v = textOf(leaf);
        if (leaf.type !== 'NumericLiteral' && !isVar(v) && v !== 'inherit') {
          report(leaf, `quoted font ${JSON.stringify(v)} in ${key}: use var(--font-sans)`);
        }
      }
    }
    if (key && RADIUS_KEYS.has(key)) {
      for (const leaf of leaves(value)) {
        const v = textOf(leaf);
        if (leaf.type === 'NumericLiteral' || (!isVar(v) && v !== '0')) {
          report(leaf, `radius ${JSON.stringify(leaf.type === 'NumericLiteral' ? leaf.value : v)} in ${key}: use a var(--radius-…) token`);
        }
      }
    }

    for (const [k, child] of Object.entries(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'extra') continue;
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(ast.program);
  return problems;
}

const all = targets.flatMap((t) => files(t)).flatMap(check);
if (all.length) {
  console.error(all.join('\n'));
  console.error(`\n✖ ${all.length} literal${all.length === 1 ? '' : 's'} outside src/styles/tokens.css`);
  process.exit(1);
}
console.log('✓ no colour, font or radius literals in JSX/JS outside src/lib/ and src/styles/');
