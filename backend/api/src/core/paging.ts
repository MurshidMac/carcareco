import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { Database } from '../db/types.js';

/**
 * Port of `PageResultQuery<T>` / `PageResultQueryExtensions`.
 *
 * The original interpolated `orderby`, the search expression and every filter
 * straight into SQL. Here search tokens, filter values and the paging window are
 * bound parameters, and `orderby` must appear in an explicit allow-list, so the
 * only unparameterised fragments are the caller-supplied projection and the
 * allow-listed sort column.
 *
 * Queries are composed as `RawBuilder` fragments and executed directly instead
 * of going through Kysely's query builder, because callers need to nest their
 * own projections (joins, CTEs, aggregate subqueries) inside the page wrapper.
 */

export interface PageRequest {
  searchText?: string | undefined;
  orderby?: string | undefined;
  limit: number;
  offset: number;
  desc: boolean;
}

/** Splits on whitespace and drops empty tokens — `WildcardTokens.AllTokens`. */
export function wildcardTokens(searchText: string | undefined): string[] {
  if (!searchText) return [];
  return searchText.split(/\s+/).filter((token) => token.length > 0);
}

/**
 * Escapes tsquery metacharacters in a search token. The .NET original relied on
 * `plainto_tsquery`, which never interprets operators; here every token becomes
 * an `ILIKE` pattern, so the escaping is not needed for correctness and is only
 * kept so a token containing `%` or `_` still matches literally.
 */
export function likePattern(token: string): string {
  return `%${token.replace(/([%_\\])/g, '\\$1')}%`;
}

export interface PageQueryOptions {
  /** Columns the caller is allowed to order by, e.g. `['id', 'name']`. */
  allowedOrderBy: readonly string[];
  defaultOrderBy: string;
}

/** A composable WHERE/ORDER BY clause, all parameters bound. */
type Fragment = RawBuilder<unknown>;

export class PageQuery {
  private readonly request: PageRequest;
  private readonly options: PageQueryOptions;
  private searchText: string | undefined;
  private searchExpression: string | undefined;
  private readonly restrictions: Fragment[] = [];

  constructor(request: PageRequest, options: PageQueryOptions) {
    this.request = request;
    this.options = options;
  }

  filterBy(searchText: string | undefined): this {
    this.searchText = searchText;
    return this;
  }

  /**
   * SQL expression searched by `filterBy`, e.g. `concat_ws(' ', a, b)`.
   * Must be a constant chosen by the caller, never derived from user input.
   */
  searchFields(expression: string): this {
    this.searchExpression = expression;
    return this;
  }

  /** Adds a boolean restriction as a parameterised Kysely fragment. */
  where(fragment: Fragment): this {
    this.restrictions.push(sql`(${fragment})`);
    return this;
  }

  /** Adds a restriction only when `condition` holds. */
  when(condition: boolean, fragment: () => Fragment): this {
    if (condition) this.where(fragment());
    return this;
  }

  /**
   * Half-open range filter: `>= from` and `< to`, either bound optional.
   * Used for the work-order start-date and invoice-date filters.
   */
  dateRange(column: string, from: string | undefined, to: string | undefined): this {
    if (from) this.where(sql`${sql.ref(column)} >= ${from}::timestamptz`);
    if (to) this.where(sql`${sql.ref(column)} < ${to}::timestamptz`);
    return this;
  }

  private whereClause(): Fragment | undefined {
    const parts: Fragment[] = [...this.restrictions];

    const tokens = wildcardTokens(this.searchText);
    if (this.searchExpression && tokens.length > 0) {
      // Every token must match, so the parts are ANDed together.
      for (const token of tokens) {
        parts.push(sql`(${sql.raw(this.searchExpression)}) ILIKE ${likePattern(token)}`);
      }
    }

    if (parts.length === 0) return undefined;
    return sql`where ${parts.reduce((acc, part) => sql`${acc} and ${part}`)}`;
  }

  private orderByClause(): Fragment {
    const requested = this.request.orderby;
    const column =
      requested && this.options.allowedOrderBy.includes(requested)
        ? requested
        : this.options.defaultOrderBy;

    // The column comes from a fixed allow-list, so inlining is safe here.
    return sql`order by ${sql.raw(column)} ${sql.raw(this.request.desc ? 'desc' : 'asc')}`;
  }

  /**
   * Wraps a caller-supplied projection and applies the where/order/paging
   * clauses. `limit + 1` rows are fetched so `hasMore` can be computed without
   * a second count query, exactly as the original did.
   */
  async execute<T>(db: Kysely<Database>, projection: string): Promise<PageResult<T>> {
    const result = await this.pageQuery<T>(projection).execute(db);
    const rows = Array.isArray(result.rows) ? result.rows : [];
    const hasMore = rows.length > this.request.limit;
    return { hasMore, items: (hasMore ? rows.slice(0, this.request.limit) : rows) as T[] };
  }

  /**
   * The composed page query, for callers that need to embed it further or
   * inspect the generated SQL.
   */
  pageQuery<T>(_projection: string): RawBuilder<Record<string, unknown>> {
    const where = this.whereClause();
    return sql`
      select page.* from (${sql.raw(projection)}) as page
      ${where}
      ${this.orderByClause()}
      limit ${this.request.limit + 1}
      offset ${this.request.offset}
    `;
  }

  /**
   * Exposes the raw clauses for the work-order query, which nests its own
   * projection and needs to embed the restrictions in the middle of the SQL.
   */
  expose(): { where?: Fragment; orderBy: Fragment } {
    return { where: this.whereClause(), orderBy: this.orderByClause() };
  }
}

export interface PageResult<T> {
  hasMore: boolean;
  items: T[];
}