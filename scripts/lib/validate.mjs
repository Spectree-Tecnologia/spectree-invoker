// A dependency-free validator for the JSON Schema subset the Invoker's contracts use.
//
// Deliberately small: type, required, properties, additionalProperties, enum, const,
// pattern, min/maxLength, minimum/maximum, minItems, items, $ref into schemas/common.json,
// and allOf/if/then. Anything a schema uses that is NOT in that list is a loud error, not a
// silent pass — a validator that quietly ignores a keyword approves whatever it cannot read.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));

const SUPPORTED = new Set([
  '$id', 'title', 'description', 'definitions',
  'type', 'required', 'properties', 'additionalProperties', 'enum', 'const',
  'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'items',
  '$ref', 'allOf', 'if', 'then',
]);

const registry = new Map();

export function loadSchemas(dir = join(root, 'schemas')) {
  if (registry.size) return registry;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (!s.$id) throw new Error(`schemas/${f}: missing $id`);
    registry.set(s.$id, s);
  }
  return registry;
}

function deref(ref) {
  loadSchemas();
  const [id, pointer] = ref.split('#');
  const doc = registry.get(id);
  if (!doc) throw new Error(`unknown schema $ref target: ${id}`);
  if (!pointer || pointer === '/') return doc;
  let node = doc;
  for (const seg of pointer.split('/').filter(Boolean)) {
    node = node?.[seg.replace(/~1/g, '/').replace(/~0/g, '~')];
    if (node === undefined) throw new Error(`unresolvable $ref: ${ref}`);
  }
  return node;
}

const typeOf = (v) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;

function check(schema, value, path, errors) {
  for (const k of Object.keys(schema)) {
    if (!SUPPORTED.has(k)) errors.push({ path, code: 'E_SCHEMA_KEYWORD', message: `schema uses unsupported keyword "${k}"` });
  }

  if (schema.$ref) return check(deref(schema.$ref), value, path, errors);

  if (schema.type) {
    const want = Array.isArray(schema.type) ? schema.type : [schema.type];
    const got = typeOf(value);
    const ok = want.some((t) => (t === 'number' ? got === 'number' || got === 'integer' : t === got));
    if (!ok) {
      errors.push({ path, code: 'E_TYPE', message: `expected ${want.join('|')}, got ${got}` });
      return;
    }
  }

  if (schema.enum && !schema.enum.some((c) => JSON.stringify(c) === JSON.stringify(value))) {
    errors.push({ path, code: 'E_ENUM', message: `not one of ${JSON.stringify(schema.enum)}` });
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    errors.push({ path, code: 'E_CONST', message: `must equal ${JSON.stringify(schema.const)}` });
  }

  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, code: 'E_PATTERN', message: `does not match /${schema.pattern}/` });
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({ path, code: 'E_MIN_LENGTH', message: `shorter than ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({ path, code: 'E_MAX_LENGTH', message: `longer than ${schema.maxLength}` });
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, code: 'E_MINIMUM', message: `below ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, code: 'E_MAXIMUM', message: `above ${schema.maximum}` });
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({ path, code: 'E_MIN_ITEMS', message: `fewer than ${schema.minItems} items` });
    }
    if (schema.items) value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, errors));
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of schema.required ?? []) {
      if (!(r in value)) errors.push({ path: `${path}.${r}`, code: 'E_REQUIRED', message: 'required property missing' });
    }
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties?.[k]) check(schema.properties[k], v, `${path}.${k}`, errors);
      else if (schema.properties && schema.additionalProperties === false) {
        errors.push({ path: `${path}.${k}`, code: 'E_ADDITIONAL', message: 'property not allowed' });
      }
    }
  }

  for (const sub of schema.allOf ?? []) check(sub, value, path, errors);

  if (schema.if) {
    const probe = [];
    check(schema.if, value, path, probe);
    if (probe.length === 0 && schema.then) check(schema.then, value, path, errors);
  }
}

/** @returns {{valid: boolean, errors: {path,code,message}[]}} */
export function validate(schemaId, value) {
  loadSchemas();
  const schema = registry.get(schemaId);
  if (!schema) throw new Error(`unknown schema: ${schemaId}`);
  const errors = [];
  check(schema, value, schemaId.split('/').pop(), errors);
  return { valid: errors.length === 0, errors };
}

export function assertValid(schemaId, value, what = 'document') {
  const r = validate(schemaId, value);
  if (!r.valid) {
    const lines = r.errors.map((e) => `  ${e.code} at ${e.path}: ${e.message}`).join('\n');
    throw new Error(`${what} does not satisfy ${schemaId}:\n${lines}`);
  }
  return value;
}
