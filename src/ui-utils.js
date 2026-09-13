// The viewport counts terminal cells, not source lines. ANSI input is escaped by the CLI.
export function cellWidth(character) {
  if (/\p{Mark}/u.test(character)) return 0;
  const cp = character.codePointAt(0);
  return cp >= 0x1100 && (cp <= 0x115f || cp >= 0x2e80 && cp <= 0xa4cf || cp >= 0xac00 && cp <= 0xd7af || cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe6f || cp >= 0xff01 && cp <= 0xff60 || cp >= 0x1f300) ? 2 : 1;
}
export function wrapRows(lines, width) {
  const rows = [];
  for (const source of lines) {
    let row = '', cells = 0;
    for (const character of source.replace(/\t/g, '    ')) {
      const size = cellWidth(character);
      if (cells + size > width && row) { rows.push(row); row = ''; cells = 0; }
      row += character; cells += size;
    }
    rows.push(row);
  }
  return rows;
}
export function decodeMouse(scroll) {
  let pending = Buffer.alloc(0);
  return { push(chunk) {
    pending = Buffer.concat([pending, chunk]); const output = [];
    while (pending.length) {
      if (pending[0] !== 27) { output.push(pending.subarray(0, 1)); pending = pending.subarray(1); continue; }
      if (pending.length < 3 && Buffer.from('\x1b[<').subarray(0, pending.length).equals(pending)) break;
      if (pending.subarray(0, 3).toString() !== '\x1b[<') { output.push(pending.subarray(0, 1)); pending = pending.subarray(1); continue; }
      const match = pending.toString().match(/^\x1b\[<(\d+);\d+;\d+([mM])/);
      if (!match) {
        if (pending.length <= 40 && /^\x1b\[<[\d;]*$/.test(pending.toString())) break;
        pending = pending.subarray(3); continue;
      }
      if (match[2] === 'M' && (match[1] === '64' || match[1] === '65')) scroll(match[1] === '64' ? 3 : -3);
      pending = pending.subarray(Buffer.byteLength(match[0]));
    }
    return Buffer.concat(output);
  } };
}
