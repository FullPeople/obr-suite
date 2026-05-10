/// <reference types="vite/client" />

declare module "*.css";
declare const require: {
  (id: string): unknown;
  resolve(id: string): string;
};
