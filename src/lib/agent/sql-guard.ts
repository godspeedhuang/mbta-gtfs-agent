/** Strip comments, require a single SELECT/WITH statement, drop the trailing semicolon. */
export function assertReadOnly(sql: string): string {
  const s = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/;\s*$/, '');
  if (!/^(select|with)\b/i.test(s)) throw new Error('Only SELECT / WITH queries are allowed');
  if (s.includes(';')) throw new Error('One statement at a time');
  return s;
}

/** Wrap in a LIMIT unless the query already ends with one. Keeps result tables bounded. */
export function withLimit(sql: string, n = 1000): string {
  const s = assertReadOnly(sql);
  return /\blimit\s+\d+\s*$/i.test(s) ? s : `SELECT * FROM (${s}) AS __q LIMIT ${n}`;
}
