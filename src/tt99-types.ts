export type FormId = 'B01' | 'B02' | 'B03';
export type PeriodKey = 'current' | 'prior';

export interface InputLine {
  form: FormId;
  code: string;
  period: PeriodKey;
  amount: string;
  source: string;
}

/** B01 periods are closing and opening balances for the reporting year. */
export interface Receivable {
  period: PeriodKey;
  customer: string;
  term: 'short' | 'long';
  debit: string;
  credit: string;
  source: string;
}

/** Current-year account rollforward. Import either leaf accounts or control accounts. */
export interface TrialRow {
  account: string;
  openingDebit: string;
  openingCredit: string;
  debit: string;
  credit: string;
  closingDebit: string;
  closingCredit: string;
  b01?: string;
  basis?: 'debit' | 'credit' | 'minusDebit' | 'minusCredit';
  source: string;
}

/** Split postings with one debit and one credit leg; classified amounts have statement presentation signs. */
export interface JournalRow {
  date: string;
  debitAccount: string;
  creditAccount: string;
  amount: string;
  b02?: string;
  b02Sign?: 1 | -1;
  b03?: string;
  b03Sign?: 1 | -1;
  cashEvidence?: string;
  period: PeriodKey;
  source: string;
}

export interface StatementsInput {
  start: string;
  end: string;
  jointStock?: boolean;
  lines: InputLine[];
  receivables: Receivable[];
  trial?: TrialRow[];
  journal?: JournalRow[];
}

export interface StatementRow {
  code: string;
  label: string;
  section?: string;
  total: boolean;
  current: string | null;
  prior: string | null;
  sources: Record<PeriodKey, string[]>;
}

export interface StatementReport {
  forms: Record<FormId, StatementRow[]>;
  issues: string[];
}
