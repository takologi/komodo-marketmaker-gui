import { WalletViewRaw } from "@/lib/kdf/client";
import { asNumber, asString } from "@/lib/kdf/adapters/common";

export interface WalletView {
  coin: string;
  address: string;
  balance: number;
  spendable: number;
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
