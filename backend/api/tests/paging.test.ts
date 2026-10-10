import { describe, expect, it } from 'vitest';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { likePattern, PageQuery, wildcardTokens } from '../src/core/paging.js';

/**
 * Compiling a raw fragment only needs a dialect, never a live connection, so a
 * pool pointing nowhere is safe here.
 */
const db = new Kysely({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: 'postgres://localhost/never' }) }),
});

describe('wildcardTokens', () => {
  it('splits on whitespace and drops empty tokens', () => {
    expect(wildcardTokens('  oil   filter ')).toEqual(['oil', 'filter']);
  });

  it('returns an empty list for undefined or empty input', () => {
    expect(wildcardTokens(undefined)).toEqual([]);
    expect(wildcardTokens('   ')).toEqual([]);
  });
});

describe('likePattern', () => {
  it('wraps the token in percent wildcards', () => {
    expect(likePattern('oil')).toBe('%oil%');
  });

  it('escapes LIKE metacharacters', () => {
    expect(likePattern('100%')).toBe('%100\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
  });
});

describe('PageQuery', () => {
  const request = { limit: 10, offset: 0, desc: false };

  it('falls back to the default order column when the requested one is not allowed', () => {
    const query = new PageQuery(
      { ...request, orderby: 'evil; drop table client' },
      { allowedOrderBy: ['name'], defaultOrderBy: 'name' },
    );
    const compiled = query.pageQuery('select name from domain.sparepart').compile(db);
    expect(compiled.sql).toContain('order by name asc');
  });

  it('honours an allow-listed order column', () => {
    const query = new PageQuery(
      { ...request, orderby: 'id', desc: true },
      { allowedOrderBy: ['name', 'id'], defaultOrderBy: 'name' },
    );
    const compiled = query.pageQuery('select 1 as id').compile(db);
    expect(compiled.sql).toContain('order by id desc');
  });

  it('ANDs every search token as a parameterised ILIKE over the search expression', () => {
    const query = new PageQuery(
      { ...request, searchText: 'oil filter' },
      { allowedOrderBy: ['name'], defaultOrderBy: 'name' },
    );
    query.searchFields("concat_ws(' ',name)");
    const compiled = query.pageQuery('select name from domain.sparepart').compile(db);
    expect(compiled.sql).toContain("(concat_ws(' ',name)) ILIKE $1");
    expect(compiled.sql).toContain("(concat_ws(' ',name)) ILIKE $2");
    expect(compiled.sql).toContain(' and ');
    // Only the search terms and the paging window are bound; the sort column
    // comes from an allow-list and is inlined as raw SQL.
    expect(compiled.parameters).toEqual(['%oil%', '%filter%', 11, 0]);
  });

  it('lets filterBy override the search text from the request', () => {
    const query = new PageQuery(
      { ...request, searchText: 'ignored' },
      { allowedOrderBy: ['name'], defaultOrderBy: 'name' },
    );
    query.filterBy('oil').searchFields('name');
    const compiled = query.pageQuery('select name from domain.sparepart').compile(db);
    expect(compiled.parameters).toEqual(['%oil%', 11, 0]);
  });

  it('omits the WHERE clause entirely when there is nothing to filter', () => {
    const query = new PageQuery(request, { allowedOrderBy: ['name'], defaultOrderBy: 'name' });
    const compiled = query.pageQuery('select 1').compile(db);
    // A stray bound parameter here would mean an interpolated `undefined`.
    expect(compiled.sql).not.toContain('where');
    expect(compiled.parameters).toEqual([11, 0]);
  });

  it('fetches limit + 1 rows so hasMore can be computed', () => {
    const query = new PageQuery(request, { allowedOrderBy: ['name'], defaultOrderBy: 'name' });
    const compiled = query.pageQuery('select 1').compile(db);
    expect(compiled.sql).toContain('limit $1');
    expect(compiled.parameters).toContain(11);
  });
});
