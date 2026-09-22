import { and, count, eq } from 'drizzle-orm';
import { newId } from '@novelstruct/core';
import type { Db } from '../client.js';
import { bookEditions, books, chapters } from '../schema/index.js';

export interface CreateBookInput {
  readonly libraryId: string;
  readonly title: string;
  readonly author?: string;
}

export interface EditionSummary {
  readonly id: string;
  readonly label: string;
  readonly chapterCount: number;
}

export interface BookSummary {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly editions: readonly EditionSummary[];
}

export async function createBook(db: Db, input: CreateBookInput): Promise<string> {
  const id = newId('book');
  await db.insert(books).values({ id, libraryId: input.libraryId, title: input.title, author: input.author ?? null });
  return id;
}

/** The oldest book with this exact title (and author, when given); undefined when none. */
export async function findBookByTitle(db: Db, title: string, author?: string): Promise<string | undefined> {
  const rows = await db
    .select({ id: books.id })
    .from(books)
    .where(author === undefined ? eq(books.title, title) : and(eq(books.title, title), eq(books.author, author)))
    .orderBy(books.createdAt)
    .limit(1);
  return rows[0]?.id;
}

export async function findEditionByLabel(
  db: Db,
  bookId: string,
  label: string,
): Promise<typeof bookEditions.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(bookEditions)
    .where(and(eq(bookEditions.bookId, bookId), eq(bookEditions.label, label)))
    .orderBy(bookEditions.createdAt)
    .limit(1);
  return rows[0];
}

export async function listEditionIds(db: Db, bookId: string): Promise<readonly string[]> {
  const rows = await db.select({ id: bookEditions.id }).from(bookEditions).where(eq(bookEditions.bookId, bookId));
  return rows.map((r) => r.id);
}

export async function getBook(db: Db, bookId: string): Promise<typeof books.$inferSelect | undefined> {
  const rows = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  return rows[0];
}

export async function listBooks(db: Db): Promise<BookSummary[]> {
  const rows = await db
    .select({
      bookId: books.id,
      title: books.title,
      author: books.author,
      editionId: bookEditions.id,
      label: bookEditions.label,
      chapterCount: count(chapters.id),
    })
    .from(books)
    .leftJoin(bookEditions, eq(bookEditions.bookId, books.id))
    .leftJoin(chapters, eq(chapters.editionId, bookEditions.id))
    .groupBy(
      books.id,
      books.title,
      books.author,
      books.createdAt,
      bookEditions.id,
      bookEditions.label,
      bookEditions.createdAt,
    )
    .orderBy(books.createdAt, bookEditions.createdAt);

  // Rows arrive grouped by book; a local accumulator keeps this linear.
  const byBook = new Map<string, { id: string; title: string; author: string | null; editions: EditionSummary[] }>();
  for (const row of rows) {
    const book = byBook.get(row.bookId) ?? { id: row.bookId, title: row.title, author: row.author, editions: [] };
    if (row.editionId !== null && row.label !== null) {
      book.editions.push({ id: row.editionId, label: row.label, chapterCount: row.chapterCount });
    }
    byBook.set(row.bookId, book);
  }
  return [...byBook.values()].map((b) => ({ ...b, editions: [...b.editions] }));
}

export interface EditionWithBook {
  readonly edition: typeof bookEditions.$inferSelect;
  readonly book: typeof books.$inferSelect;
}

export async function getEdition(db: Db, editionId: string): Promise<EditionWithBook | undefined> {
  const rows = await db
    .select({ edition: bookEditions, book: books })
    .from(bookEditions)
    .innerJoin(books, eq(books.id, bookEditions.bookId))
    .where(eq(bookEditions.id, editionId))
    .limit(1);
  return rows[0];
}
