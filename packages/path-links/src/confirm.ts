import { App, ButtonComponent, Modal } from "obsidian";

class ConfirmRiskyOpen extends Modal {
  private decided = false;

  constructor(app: App, private path: string, private resolve: (ok: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    this.setTitle("プログラムとして実行されるファイルです");
    contentEl.createEl("p", {
      text: "このリンク先は、開くとプログラムやスクリプトとして実行される種類のファイルです。自分で置いたファイルか確認してから開いてください。",
    });
    contentEl.createEl("code", { text: this.path, cls: "path-links-confirm-path" });

    const buttons = contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = new ButtonComponent(buttons).setButtonText("キャンセル").setCta().onClick(() => this.finish(false));
    new ButtonComponent(buttons).setButtonText("開く").setWarning().onClick(() => this.finish(true));
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

export function confirmRiskyOpen(app: App, path: string): Promise<boolean> {
  return new Promise((resolve) => new ConfirmRiskyOpen(app, path, resolve).open());
}
