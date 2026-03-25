import { WalletViewRaw } from "@/lib/kdf/client";
import { asNumber, asString } from "@/lib/kdf/adapters/common";

export interface WalletView {
  coin: string;
  address: string;
  balance: number;
  spendable: number;
}

export function adaptWallets(raw: WalletViewRaw[]): WalletView[] {
  return raw.map((row) => ({
    coin: asString(row.ticker ?? row.coin, "unknown"),
    address: asString(row.address, "n/a"),
    balance: asNumber(row.balance),
    spendable: asNumber(row.spendable_balance ?? row.available),
  }));
}
