export const getLocalLang = () => (globalThis as any).__transitionFixture?.language ?? "en";
export const onLangChange = (_listener: (language: "en" | "zh") => void) => () => {};
