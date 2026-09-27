import { App, ButtonComponent, Modal } from "obsidian";
import type { Strings } from "./i18n.ts";

class ConfirmRiskyOpen extends Modal {
  private decided = false;

  constructor(app: App, private path: string, private s: Strings, private resolve: (ok: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    const t = this.s.confirm;
    this.setTitle(t.title);
    contentEl.createEl("p", { text: t.body });
    contentEl.createEl("code", { text: this.path, cls: "path-links-confirm-path" });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = new ButtonComponent(buttons).setButtonText(t.cancel).setCta().onClick(() => this.finish(false));
    new ButtonComponent(buttons).setButtonText(t.open).setWarning().onClick(() => this.finish(true));
    // Enter must not run the file by accident.
    window.setTimeout(() => cancel.buttonEl.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.decided) this.resolve(false);
  }

  private finish(ok: boolean): void {
    this.decided = true;
    this.resolve(ok);
    this.close();
  }
}

export function confirmRiskyOpen(app: App, path: string, s: Strings): Promise<boolean> {
  return new Promise((resolve) => new ConfirmRiskyOpen(app, path, s, resolve).open());
}
