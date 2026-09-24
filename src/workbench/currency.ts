export const COIN_TYPES = ['cp','sp','ep','gp','pp'] as const;
export type CoinValues = Record<typeof COIN_TYPES[number],number>;

/** Stable XLSX imports wrap denominations in currency.wallet and also include
 * total_gp metadata. The wire/catalog/stock contract is only five numbers. */
export function normalizeCoins(value:unknown):CoinValues {
 const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const wallet=raw.wallet&&typeof raw.wallet==='object'?raw.wallet as Record<string,unknown>:raw;
 return Object.fromEntries(COIN_TYPES.map(coin=>{const source=wallet[coin],number=typeof source==='number'||typeof source==='string'?Number(source):0;return [coin,Number.isFinite(number)?number:0];})) as CoinValues;
}

export function documentCoins(doc:any):CoinValues {
 return normalizeCoins(doc?.dnd_card_web?.inventory?.coins??doc?.inventory?.coins??doc?.inventory?.currency);
}
