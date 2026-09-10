/** URLs only: importing this module does not fetch or decode the card pack.
 * Card IDs are persistent identities, not printed strengths (white-6 is the
 * user's seven-point White Dragon). Never choose an image by numeric strength. */
export function cardFaceURL(id:string):string {
 return new URL(`./art/pack-20260910/cards/${id}.webp`,import.meta.url).href;
}
export function cardFaceImage(id:string,alt=""):HTMLImageElement {
 const image=document.createElement("img");image.className="printed-card-face";
 image.src=cardFaceURL(id);image.alt=alt;image.draggable=false;image.decoding="async";
 image.width=768;image.height=1357;return image;
}
