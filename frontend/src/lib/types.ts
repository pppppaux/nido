export type User = { id: number; username: string; display_name: string; color: string };

export type Category = { id: string; name: string };

export type House = {
  name: string;
  members: User[];
  categories: Category[];
  registration_open: boolean;
  receipts_enabled: boolean;
  invite_code: string | null;
};

export type Item = {
  id: number;
  name: string;
  quantity: string;
  note: string;
  category: string;
  owner_id: number | null;
  urgent: boolean;
  pantry_id: number | null;
  created_by: number | null;
  created_at: string;
  bought_by: number | null;
  bought_at: string | null;
  price_cents: number | null;
};

export type Level = "ok" | "low" | "out";

export type PantryEntry = {
  id: number;
  name: string;
  category: string;
  owner_id: number | null;
  level: Level;
  updated_by: number | null;
  updated_at: string;
};

export type Expense = {
  id: number;
  kind: "purchase" | "expense" | "settlement";
  description: string;
  amount_cents: number;
  paid_by: number;
  item_id: number | null;
  spent_on: string;
  created_by: number | null;
  created_at: string;
  shares: { user_id: number; share_cents: number }[];
};

export type Money = {
  balances: { user_id: number; balance_cents: number }[];
  transfers: { from: number; to: number; amount_cents: number }[];
  expenses: Expense[];
  month_total_cents: number;
};

export type Activity = {
  id: number;
  user_id: number | null;
  kind: string;
  subject: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export type Suggestion = { name: string; category: string };

export type ReceiptLine = {
  name: string;
  quantity: string;
  price_cents: number;
  item_id: number | null;
  owner_id: number | null;
  category: string;
};

export type ReceiptDraft = {
  store: string | null;
  date: string | null;
  total_cents: number | null;
  sum_cents: number;
  lines: ReceiptLine[];
};
