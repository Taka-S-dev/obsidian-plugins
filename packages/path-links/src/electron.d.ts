declare module "electron" {
  export const clipboard: {
    readText(): string;
    writeText(text: string): void;
  };
  export const shell: { openPath(path: string): Promise<string> };
}
