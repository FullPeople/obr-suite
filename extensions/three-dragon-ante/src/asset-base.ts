export const assetUrl = (path: string): string => new URL(`${import.meta.env.BASE_URL}${path}`, location.origin).href;
