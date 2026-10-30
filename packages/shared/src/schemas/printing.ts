import { z } from 'zod';
import { PrintableDocType, PrintFormat } from '../enums';
import { statementQuerySchema } from './clients';

const formatField = z.enum([PrintFormat.A4, PrintFormat.A5]).optional();

/** `?format=A4|A5`; missing = the tenant's default format. */
export const printQuerySchema = z.object({ format: formatField });
export type PrintQuery = z.infer<typeof printQuerySchema>;

export const printableDocTypeSchema = z.enum([
  PrintableDocType.BL,
  PrintableDocType.FAC,
  PrintableDocType.AV,
  PrintableDocType.BR,
  PrintableDocType.TR,
  PrintableDocType.BC,
]);

/** Relevé de compte PDF: the statement range plus the paper format. */
export const statementPdfQuerySchema = statementQuerySchema.and(printQuerySchema);
export type StatementPdfQuery = z.infer<typeof statementPdfQuerySchema>;
