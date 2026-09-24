// Original vector artwork, authored for this extension. No external images/fonts.
const svg = (viewBox: string, content: string) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '" aria-hidden="true" focusable="false">' + content + '</svg>';
export const CAMPFIRE = svg("0 0 240 250", `
<ellipse cx="120" cy="221" rx="91" ry="14" fill="#e5a45d" opacity=".09"/>
<g stroke="#b58a63" stroke-width="5" stroke-linecap="round"><path d="M57 220l120-41" stroke="#73533d" stroke-width="18"/><path d="M64 180l118 40" stroke="#906346" stroke-width="18"/><path d="M57 220l120-41"/><path d="M64 180l118 40"/></g>
<path d="M120 204c-49 0-62-40-40-79 2 22 12 23 13 25-6-51 39-72 30-120 53 46 4 84 35 101 9-5 15-18 16-26 36 61 2 99-54 99" fill="#e57938"/>
<path d="M120 197c-29-2-36-26-22-51 1 11 10 17 14 19-3-25 21-40 19-65 28 40-4 45 16 63 4 20-8 35-27 34" fill="#ffc46b"/>
<path d="M120 195c-16-2-16-18-3-36 0 10 10 13 13 22 2 7-3 14-10 14" fill="#fff1bf"/>
<g fill="#e4b271"><circle cx="74" cy="224" r="3"/><circle cx="168" cy="228" r="2"/></g>`);
export const TENT = svg("0 0 420 250", `
<ellipse cx="210" cy="220" rx="196" ry="19" fill="#7a8b83" opacity=".12"/>
<path d="M20 218L166 37l214 168-183 25z" fill="#485957"/>
<path d="M166 37l31 193L42 207z" fill="#cab38a"/>
<path d="M166 37l31 193 178-25z" fill="#837d61"/>
<path d="M164 82L83 209l107 15z" fill="#192625"/>
<path d="M168 108l-24 106 46 10z" fill="#e4b46d" opacity=".82"/>
<path d="M166 37l31 193M165 38L20 218M166 37l214 168" fill="none" stroke="#f1d5a1" stroke-width="3"/>
<path d="M166 39L6 218m372-13 34 13" fill="none" stroke="#a8a08a" stroke-width="2"/>
<path d="M5 205v23m407-21v22" stroke="#bfaa7f" stroke-width="4" stroke-linecap="round"/>`);
export const CLOCK = svg("0 0 200 250", `
<path d="M79 25h42M100 25V12" stroke="#ddc59c" stroke-width="6" stroke-linecap="round"/>
<circle cx="100" cy="117" r="78" fill="#151a21" stroke="#a5906e" stroke-width="3"/>
<circle cx="100" cy="117" r="66" fill="none" stroke="#534c40" stroke-width="1"/>
<g stroke="#ddc59c" stroke-width="3"><path d="M100 58v11m0 96v11M41 117h11m96 0h11"/><path d="M70 66l5 9m50 84 5 9M49 87l9 5m84 50 9 5M49 147l9-5m84-50 9-5M70 168l5-9m50-84 5-9"/></g>
<g class="clock-hand"><path d="M100 117V77m0 40 28 16" fill="none" stroke="#f6ddb0" stroke-width="5" stroke-linecap="round"/><circle cx="100" cy="117" r="5" fill="#f6ddb0"/></g>
<g class="clock-pendulum"><path d="M100 193v33" stroke="#b19d7a" stroke-width="3"/><circle cx="100" cy="226" r="11" fill="#c3a16b"/></g>`);
export const MOON = svg("0 0 100 100", `<path d="M72 14A40 40 0 1 0 85 72 35 35 0 0 1 72 14" fill="#d8e5dc"/><circle cx="27" cy="49" r="4" fill="#b7cbbd" opacity=".45"/>`);
export const SUN = svg("0 0 100 100", `<g fill="none" stroke="#dab575" stroke-width="3" stroke-linecap="round"><path d="M50 3v9m0 76v9M3 50h9m76 0h9M17 17l7 7m52 52 7 7M17 83l7-7m52-52 7-7"/></g><circle cx="50" cy="50" r="29" fill="#f1cf83"/>`);
