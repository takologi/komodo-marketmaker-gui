import { WalletViewRaw } from "@/lib/kdf/client";
import { asNumber, asString } from "@/lib/kdf/adapters/common";

export interface WalletView {
  coin: string;
  address: string;
  balance: number;
  spendable: number;
}

export interface WalletTxHistoryItem {
  txid: string;
  timestamp?: number;
  amount?: number;
  direction?: "sent" | "received" | "self" | "unknown";
  fromAddresses?: string[];
  toAddresses?: string[];
  fromExplorerUrls?: string[];
  toExplorerUrls?: string[];
  confirmations?: number;
  blockHeight?: number;
  blockHash?: string;
  explorerUrl?: string;
}

export interface WalletTxHistoryView {
  available: boolean;
  message?: string;
  rows: WalletTxHistoryItem[];
}

/** Enriched wallet entry — includes all bootstrap-configured coins, even those
 *  that failed activation. `activated=false` entries carry an `error` string
 *  instead of address/balance. */
export interface WalletViewEnriched {
  coin: string;
  activated: boolean;
  /** Wallet address — present only when `activated=true`. */
  address?: string;
  /** Total balance — present only when `activated=true`. */
  balance?: number;
  /** Spendable balance — present only when `activated=true`. */
  spendable?: number;
  /** Required confirmations returned by KDF balance call, if present. */
  requiredConfirmations?: number;
  /** Unspendable portion returned by KDF, if present. */
  unspendable?: number;
  /** Optional per-wallet transaction history information. */
  txHistory?: WalletTxHistoryView;
  /** Quote ticker used for external reference prices (e.g. USDT). */
  referenceQuoteTicker?: string;
  /** External reference prices by source id, only reachable sources with values. */
  referencePricesBySource?: Record<string, number> | null;
  /** Activation error message — present only when `activated=false`. */
  error?: string;
}

export function adaptWallets(raw: WalletViewRaw[]): WalletView[] {
  return raw.map((row) => {
    const balance = asNumber(row.balance);
    const unspendable = asNumber(row.unspendable_balance, 0);
    const explicitSpendable = asNumber(row.spendable_balance ?? row.available, Number.NaN);

    return {
      coin: asString(row.ticker ?? row.coin, "unknown"),
      address: asString(row.address, "n/a"),
      balance,
      spendable: Number.isNaN(explicitSpendable)
        ? Math.max(0, balance - unspendable)
        : explicitSpendable,
    };
  });
}
