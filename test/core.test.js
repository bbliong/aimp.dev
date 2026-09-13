import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStatus } from '../src/core/git.js';
import { validatePath } from '../src/core/files.js';
import { tokenize } from '../src/cli.js';
import { decodeMouse, wrapRows } from '../src/ui-utils.js';

test('NUL parser preserves leading status columns and literal path bytes', () => {
  assert.deepEqual(parseStatus(Buffer.from(' M app.txt\0?? a b\n日本.txt\0R  destination\0old name\0')), [
    {path:'app.txt',code:' M'}, {path:'a b\n日本.txt',code:'??'}, {path:'destination',code:'R '}, {path:'old name',code:' D'},
  ]);
  assert.throws(() => parseStatus(Buffer.from(' M no terminator')));
});
test('containment rejects traversal and metadata, permits harmless double dots', () => {
  for (const value of ['../outside', '/etc/passwd', 'a/../../b', '.git/config', 'a/.git/config', 'a\\b']) assert.throws(()=>validatePath(value));
  assert.equal(validatePath('a..b'), 'a..b');
});
test('command arguments support quoted paths and reject incomplete input', () => {
  assert.deepEqual(tokenize('/serialize "a b.py" \'two.txt\''), ['/serialize','a b.py','two.txt']);
  assert.throws(()=>tokenize('/init "unfinished'));
});
test('mouse decoder handles fragmented packets and leaves normal keys intact', () => {
  const events=[], d=decodeMouse(x=>events.push(x));
  assert.equal(d.push(Buffer.from('a\x1b[<65;')).toString(), 'a');
  assert.equal(d.push(Buffer.from('30;12M/status')).toString(), '/status');
  assert.deepEqual(events,[-3]);
  assert.equal(d.push(Buffer.from('\x1b[A')).toString(),'\x1b[A');
});
test('viewport wraps long lines and CJK into terminal rows', () => {
  assert.deepEqual(wrapRows(['abcdefgh', '日本x'], 4), ['abcd','efgh','日本','x']);
});
