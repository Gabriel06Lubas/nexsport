import { createId } from "@paralleldrive/cuid2";
import { foreignKey, index, text, timestamp, uniqueIndex, type PgColumn } from "drizzle-orm/pg-core";

// Shared column and constraint builders for the schema files.
//
// Constraint and index names are spelled out (Prisma's convention:
// `<Table>_<cols>_fkey|_idx|_key`) rather than left to Drizzle's defaults.
// The database guards, the SQL tests and the app's error handling all refer
// to constraints by name, so names are part of the contract.

/** Primary key: a collision-resistant, URL-safe id generated in the app. */
export const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => createId());

/** `timestamptz(3)`: every timestamp in nexport is time-zone aware. */
export const tstz = () => timestamp({ precision: 3, withTimezone: true, mode: "date" });

export const createdAt = () => tstz().notNull().defaultNow();

/** Set by the app on insert and on every update made through Drizzle. */
export const updatedAt = () =>
  tstz()
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

type Columns = [PgColumn, ...PgColumn[]];
const joinNames = (columns: PgColumn[]) => columns.map((c) => c.name).join("_");

/** Foreign key named `<Table>_<cols>_fkey`; key updates always cascade. */
export const fk = (table: string, columns: Columns, foreignColumns: Columns) =>
  foreignKey({ name: `${table}_${joinNames(columns)}_fkey`, columns, foreignColumns }).onUpdate("cascade");

/** Index named `<Table>_<cols>_idx`. */
export const idx = (table: string, ...columns: Columns) => index(`${table}_${joinNames(columns)}_idx`).on(...columns);

/** Unique index named `<Table>_<cols>_key`. */
export const uniq = (table: string, ...columns: Columns) =>
  uniqueIndex(`${table}_${joinNames(columns)}_key`).on(...columns);
