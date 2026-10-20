/**
 * The C-family outline: the scanner, and the one route that feeds it.
 *
 * What is worth pinning is what the outline promises to a reader:
 *
 * - a definition is reported where it starts (the return type's line), not at
 *   the brace or the name;
 * - comments, strings and preprocessor lines cannot invent symbols, and a
 *   variable whose type names a tag (`struct Point p = {0};`) is not a type;
 * - an anonymous `typedef struct { … } Name` is reported under the name the
 *   typedef gives it;
 * - prototypes belong to headers, where they are the API, and not to sources,
 *   where the same file usually carries both;
 * - the route refuses what it cannot read (relative path, foreign extension,
 *   missing file, a directory) with stable codes, and answers symbols otherwise.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, it } from 'node:test'

const { scanSource } = await import('../lib/host/features/outline/scan.js')
const { C_FAMILY } = await import('../lib/host/features/outline/profiles/c.js')
const { JS_FAMILY } = await import('../lib/host/features/outline/profiles/js.js')
const { SHELL_FAMILY } = await import('../lib/host/features/outline/profiles/shell.js')
const { profileFor } = await import('../lib/host/features/outline/profiles/index.js')
const { createOutlineHandlers } = await import('../lib/host/features/outline/api.js')

const root = mkdtempSync(join(tmpdir(), 'dsh-smkit-outline-'))
after(() => rmSync(root, { recursive: true, force: true }))

/** Write one source file and return its absolute path. */
function source(name, text, encoding = 'utf8') {
  const path = join(root, name)
  writeFileSync(path, text, encoding)
  return path
}

/** `name → line` of the symbols a scan produced, for compact assertions. */
function lines(sourceText, options) {
  return Object.fromEntries(scanSource(sourceText, C_FAMILY, options).map((symbol) => [symbol.name, symbol.line]))
}

const SAMPLE = `#include <stdio.h>
#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define BUF_SIZE 64

/* struct Fake { int x; }; */
typedef struct Node {
    int value;
    struct Node *next;
} Node;

typedef struct {
    int count;
} Tracker;

struct Point {
    int x;
    int y;
};

enum Color { RED, GREEN, BLUE };

static int
add(int a, int b)
{
    return a + b;
}

const char *greet(void) { return "int fake(void) {"; }

static void (*handler)(int) = 0;

int declared_only(int x);

union Value {
    int i;
};
`

it('reports definitions at the line they start on', () => {
  const found = lines(SAMPLE)
  assert.equal(found.Node, 6)
  assert.equal(found.Tracker, 11)
  assert.equal(found.Point, 15)
  assert.equal(found.Color, 20)
  assert.equal(found.add, 22, 'the return type line, not the name line')
  assert.equal(found.greet, 28)
  assert.equal(found.Value, 34)
})

it('names an anonymous aggregate after its typedef', () => {
  const tracker = scanSource(SAMPLE, C_FAMILY).find((symbol) => symbol.name === 'Tracker')
  assert.equal(tracker?.kind, 'struct')
  assert.equal(scanSource(SAMPLE, C_FAMILY).some((symbol) => symbol.name === ''), false)
})

it('reports both macro forms, and never one from a comment or literal', () => {
  const names = scanSource(SAMPLE, C_FAMILY).map((symbol) => symbol.name)
  assert.equal(names.includes('MAX'), true, 'a function-like define is a name')
  assert.equal(names.includes('BUF_SIZE'), true, 'an object-like define is a name too')
  assert.equal(names.includes('Fake'), false, 'a declaration inside a comment')
  assert.equal(names.includes('fake'), false, 'a declaration inside a string literal')
})

it('does not read a variable whose type names a tag as the type', () => {
  const text = `struct Point { int x; };
void use(void) {
    struct Point p = {0};
    (void)p;
}
struct Point *allocate(void);
`
  const names = scanSource(text, C_FAMILY).map((symbol) => symbol.name)
  assert.equal(names.filter((name) => name === 'Point').length, 1)
  assert.equal(names.includes('use'), true)
})

it('skips a function-pointer variable in both modes', () => {
  const text = 'static void (*handler)(int) = 0;\nint real(void) { return 0; }\n'
  assert.deepEqual(scanSource(text, C_FAMILY).map((symbol) => symbol.name), ['real'])
  assert.deepEqual(scanSource(text, C_FAMILY, { prototypes: true }).map((symbol) => symbol.name), ['real'])
})

/**
 * The shape a real C file has: configuration macros, aggregate definitions and
 * global tables around the functions, not one family per file. The fixture
 * directory (`.tmp/outline-fixtures/c/mixed.c`) carries the long version; this
 * is the part worth keeping in CI.
 */
const MIXED = `#define LIMIT 32
#define UNUSED(value) ((void)(value))
#define DEFINE_GETTER(type, field) \\
    type get_##field(void) { return 0; }

typedef enum { IDLE, READY } state;

typedef struct node node_t;

struct reading {
    union {
        double real;
        long integer;
    } value;
};

struct node {
    char name[16];
    state state;
    struct reading last;
    struct node *next;
};

static node_t pool[LIMIT];
static int (*const compare)(const void *, const void *) = 0;
static const struct reading empty = { .value = { .real = 0 } };
static const char *const banner = "struct fake { int x; };";

static void reset(struct node *node)
{
    if (node == 0) {
        return;
    }
}

int create(const char *name)
{
    return name != 0;
}

#ifdef DEBUG
int debug_count(void) { return 1; }
#else
int debug_count(void) { return 0; }
#endif

int legacy(a)
    int a;
{
    return a;
}
`

it('reads a realistic module, not one syntax family per file', () => {
  const found = lines(MIXED)
  assert.deepEqual(Object.keys(found).sort(), [
    'DEFINE_GETTER',
    'LIMIT',
    'UNUSED',
    'create',
    'debug_count',
    'node',
    'reading',
    'reset',
    'state',
  ])
  // Both arms of the conditional compile are definitions of the same name.
  assert.equal(scanSource(MIXED, C_FAMILY).filter((symbol) => symbol.name === 'debug_count').length, 2)
  // Globals, initialiser braces and macro bodies never become symbols.
  for (const name of ['pool', 'compare', 'empty', 'banner', 'get_0']) {
    assert.equal(found[name], undefined, name + ' is not a symbol')
  }
  // A K&R parameter list stays the documented gap.
  assert.equal(found.legacy, undefined)
})

/**
 * A declaration with a wrapped parameter list, next to one without: what the
 * hover label is built from, and what it must not include (the body's brace).
 */
const SIGNED = `int add(int left, int right);

long multiply(
    int left,
    int right
)
{
    return left * right;
}

struct point { int x; };
`

it('quotes a function\u2019s declaration as its label, and only for functions', () => {
  const symbols = scanSource(SIGNED, C_FAMILY, { prototypes: true })
  const found = new Map(symbols.map((symbol) => [symbol.name, symbol]))
  assert.equal(found.get('add')?.signature, 'int add(int left, int right)')
  // A wrapped list is folded into one line, and the body's brace is not part of it.
  assert.equal(found.get('multiply')?.signature, 'long multiply(int left, int right)')
  // Types and macros have nothing to quote; the row already shows their name.
  assert.equal(found.get('point')?.signature, undefined)
})

it('reports prototypes only when asked, which is what a header is', () => {
  const text = 'int declared_only(int x);\nint defined(void) { return 0; }\n'
  assert.deepEqual(scanSource(text, C_FAMILY).map((symbol) => symbol.name), ['defined'])
  assert.deepEqual(
    scanSource(text, C_FAMILY, { prototypes: true }).map((symbol) => symbol.name),
    ['declared_only', 'defined'],
  )
})

/** One request as the route receives it. */
function request(url) {
  return {
    method: 'GET',
    url,
    headers: {},
    async *[Symbol.asyncIterator]() {},
  }
}

/** A response that records what the handler wrote. */
function response() {
  return {
    status: 0,
    payload: undefined,
    writeHead(code) { this.status = code },
    end(text) { this.payload = JSON.parse(text) },
    setHeader() {},
  }
}

/** Drive the feature's handler list for one query. */
async function call(query) {
  const res = response()
  const url = `http://localhost/smkit/api/outline${query}`
  const facts = { url: new URL(url), rest: '/outline', origin: 'http://localhost', idMatch: null }
  for (const handle of createOutlineHandlers()) {
    if (await handle(request(url), res, facts)) {
      return { claimed: true, status: res.status, body: res.payload }
    }
  }
  return { claimed: false }
}

/** `?path=<absolute>` for a file on disk. */
function forPath(path) {
  return `?path=${encodeURIComponent(path)}`
}

it('answers the symbols of a source file', async () => {
  const path = source('sample.c', SAMPLE)
  const answer = await call(forPath(path))
  assert.equal(answer.claimed, true)
  assert.equal(answer.status, 200)
  const names = answer.body.symbols.map((symbol) => symbol.name)
  assert.equal(names.includes('add'), true)
  assert.equal(names.includes('declared_only'), false, 'a source keeps its prototypes out')
})

it('reads a header as its prototypes', async () => {
  const path = source('sample.h', 'int declared_only(int x);\nstruct Point { int x; };\n')
  const answer = await call(forPath(path))
  assert.equal(answer.status, 200)
  assert.deepEqual(answer.body.symbols.map((symbol) => symbol.name), ['declared_only', 'Point'])
})

it('refuses a relative path, a foreign extension, a directory and a missing file', async () => {
  const relative = await call('?path=src%2Fmain.c')
  assert.equal(relative.status, 400)
  assert.equal(relative.body.code, 'outline/not-absolute')

  const foreign = await call(forPath(source('notes.txt', 'int f(void) {}')))
  assert.equal(foreign.status, 415)
  assert.equal(foreign.body.code, 'outline/unsupported')

  const folder = join(root, 'folder.c')
  mkdirSync(folder, { recursive: true })
  const directory = await call(forPath(folder))
  assert.equal(directory.status, 400)
  assert.equal(directory.body.code, 'outline/not-file')

  const missing = await call(forPath(join(root, 'gone.c')))
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, 'outline/missing')
})

it('still scans a file saved in the local ANSI code page', async () => {
  // `/* 中文 */` in GBK: the comment must vanish, not swallow the declaration
  // after it — which is what decoding those bytes as UTF-8 risks.
  let bytes
  try {
    bytes = Buffer.from([0x2f, 0x2a, 0x20, 0xd6, 0xd0, 0xce, 0xc4, 0x20, 0x2a, 0x2f, 0x0a])
  } catch {
    bytes = null
  }
  assert.notEqual(bytes, null)
  const body = Buffer.concat([bytes, Buffer.from('int gbk_fn(void) { return 0; }\n', 'utf8')])
  const path = join(root, 'gbk.c')
  writeFileSync(path, body)
  const answer = await call(forPath(path))
  assert.equal(answer.status, 200)
  assert.deepEqual(answer.body.symbols.map((symbol) => symbol.name), ['gbk_fn'])
})

/* ------------------------------------------------------------------------- *
 * JavaScript / TypeScript: the same walk, a different spelling of "declares".
 * ------------------------------------------------------------------------- */

/** `name → line` for one source, read with the JavaScript profile. */
function jsLines(text) {
  return Object.fromEntries(
    scanSource(text, JS_FAMILY, { prototypes: true }).map((symbol) => [symbol.name, symbol.line]),
  )
}

it('reads a class through its base list, and names what it declares', () => {
  const text = `export class MemoryStore<T> extends Base implements Store<T> {
  put(value: T): void {
    this.items.set('1', value)
  }
}
`
  const found = jsLines(text)
  assert.equal(found.MemoryStore, 1)
  assert.equal(found.put, undefined, 'a method lives inside a body, not at the top level')
})

it('names an arrow assigned to a const, with or without a block', () => {
  const text = `export const twice = (n) => n * 2
export const later = async (id) => {
  return id
}
`
  const found = jsLines(text)
  assert.equal(found.twice, 1)
  assert.equal(found.later, 2)
})

it('ends a statement at the next declaration, the way the language does', () => {
  const text = `const first = () => 1
function second() {
  return 2
}
const notAFunction = 42
`
  assert.deepEqual(Object.keys(jsLines(text)).sort(), ['first', 'second'])
})

it('reports the class behind a decorator, and not the decorator', () => {
  const text = `@sealed
export class App {
}
`
  const found = jsLines(text)
  assert.deepEqual(Object.keys(found), ['App'])
  assert.equal(found.App, 2)
})

it('reads CommonJS member assignments, and leaves calls alone', () => {
  const text = `exports.slugify = function (text) { return text }
Thing.prototype.get = function get(name) { return name }
setTimeout(() => { work() }, 0)
`
  const found = jsLines(text)
  assert.deepEqual(Object.keys(found).sort(), ['get', 'slugify'])
})

it('masks template literals and comments', () => {
  const text = 'const label = `function fake() {`\n// function alsofake() {\nconst real = () => 1\n'
  assert.deepEqual(Object.keys(jsLines(text)), ['real'])
})

it('reads a second language without touching the walk', () => {
  // A profile that is not shipped: `--` comments, `record` aggregates, no
  // preprocessor and no typedefs. If this needs code in `scan.ts`, the seam is
  // in the wrong place.
  const toy = {
    id: 'toy',
    syntax: { lineComments: ['--'], strings: ['"'] },
    aggregates: new Map([['record', 'struct']]),
    prototypes: () => false,
  }
  const text = `record Point {
  x, y
}

fn area(w, h) {
  return w * h
}
-- fn commented(w) { }
`
  const found = scanSource(text, toy)
  assert.deepEqual(found.map((symbol) => [symbol.kind, symbol.name]), [
    ['struct', 'Point'],
    ['function', 'area'],
  ])
})

/* ------------------------------------------------------------------------- *
 * Shell: both function spellings, and the two things that look like code.
 * ------------------------------------------------------------------------- */

/** `name → line` for one script, read with the shell profile. */
function shellLines(text) {
  return Object.fromEntries(scanSource(text, SHELL_FAMILY).map((symbol) => [symbol.name, symbol.line]))
}

it('reads both shell function spellings, and nothing else', () => {
  const text = `#!/bin/sh
PREFIX=${'${INSTALL_PREFIX#/usr}'}
COUNT=$#

log() {
    echo "$1"
}

function die {
    exit 1
}

alias ll='ls -lah'
main "$@"
`
  assert.deepEqual(shellLines(text), { log: 5, die: 9 })
})

it('does not read a heredoc body as code', () => {
  const text = `usage() {
    cat <<EOF
install() { echo "not a function"; }
EOF
}
`
  assert.deepEqual(shellLines(text), { usage: 1 })
})

it('keeps a heredoc opener that never closes from eating the file', () => {
  const text = `echo "a <<EOF"
real() {
    true
}
`
  assert.deepEqual(shellLines(text), { real: 2 })
})

it('claims a shell rc file by name, not by suffix', () => {
  assert.equal(profileFor('/home/dev/.zshrc')?.profile.id, 'shell-family')
  assert.equal(profileFor('/home/dev/.bashrc')?.profile.id, 'shell-family')
  assert.equal(profileFor('/home/dev/script.sh')?.profile.id, 'shell-family')
  assert.equal(profileFor('/home/dev/notes.txt'), undefined)
})
