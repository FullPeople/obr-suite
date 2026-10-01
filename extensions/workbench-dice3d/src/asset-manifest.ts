import vendor from '../public/vendor/lock.json';
import assets from '../public/asset-hashes.json';

// Immutable release metadata travels with the hashed program. A small JSON
// request must not gate physics or disable integrity checks on other assets.
export const VENDOR_LOCK=vendor;
export const ASSET_LOCKS:Readonly<Record<string,string>>=Object.freeze({
  ...assets,
  ...Object.fromEntries(Object.entries(vendor.files).map(([name,digest])=>['vendor/'+name,digest])),
});
