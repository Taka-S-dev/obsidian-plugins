import { App, getLanguage, Plugin, PluginSettingTab, Setting } from "obsidian";
import { stringsFor, type Strings } from "./i18n.ts";
import { dedupe, loadIgnored, sameIgnored, type Ignored } from "./ignored.ts";
import { scanVault, type Report } from "./scan.ts";
import { parseFolders } from "./vault-scan.ts";
import { LooseEndsView, VIEW_TYPE } from "./view.ts";

interface Settings {
  /** Folders left out, one per line. */
  ignore: string;
  /** What was taken off the lists by hand; shown, and given back, in the "Taken off" tab. */
  ignored: Ignored[];
  /** Servers allowed to be contacted when links outside the vault are checked, lower case. */
  hosts: string[];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Nothing runs in the background: the vault is read when the list is opened or scanned again, and
 * after something is moved to the trash from it.
 */
export default class LooseEnds extends Plugin {
  s!: Strings;
  settings: Settings = { ignore: "", ignored: [], hosts: [] };

  async onload(): Promise<void> {
    this.s = stringsFor(getLanguage());
    const saved = (await this.loadData()) as (Partial<Settings> & { ignoredFiles?: unknown }) | null;
    this.settings = {
      ignore: typeof saved?.ignore === "string" ? saved.ignore : "",
      // ignoredFiles: the earlier setting, unused files only.
      ignored: loadIgnored(saved?.ignored, saved?.ignoredFiles),
      hosts: strings(saved?.hosts),
    };
    this.registerView(VIEW_TYPE, (leaf) => new LooseEndsView(leaf, this));
    this.addRibbonIcon("eraser", this.s.open, () => void this.openView());
    this.addCommand({ id: "open", name: this.s.openCommand, callback: () => void this.openView() });
    this.addSettingTab(new LooseEndsSettingTab(this.app, this));
  }

  /**
   * Leaves out the folders in the setting and the templates folder of Obsidian's Templates, whose
   * links are examples. What was taken off by hand is still in the report; the list leaves it out.
   */
  async scan(): Promise<Report> {
    const ignore = parseFolders(this.settings.ignore);
    const templates = templatesFolder(this.app);
    return scanVault(this.app, templates ? [...ignore, templates] : ignore);
  }

  /** Opens the list in a tab, or shows the one already open and scans again. */
  async openView(): Promise<void> {
    const open = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = open ?? this.app.workspace.getLeaf("tab");
    if (!open) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    if (open && leaf.view instanceof LooseEndsView) await leaf.view.refresh();
  }

  /** Takes something off its list. */
  async ignore(item: Ignored): Promise<void> {
    this.settings.ignored = dedupe([...this.settings.ignored, item]);
    await this.saveData(this.settings);
  }

  /** Puts things taken off back on their lists. */
  async restore(items: Ignored[]): Promise<void> {
    this.settings.ignored = this.settings.ignored.filter((i) => !items.some((j) => sameIgnored(i, j)));
    await this.saveData(this.settings);
  }

  /** Remembers servers allowed to be contacted, so the next check does not ask again. */
  async trustHosts(hosts: string[]): Promise<void> {
    this.settings.hosts = [...new Set([...this.settings.hosts, ...hosts.map((h) => h.toLowerCase())])].sort();
    await this.saveData(this.settings);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/** The folder set in the core Templates plugin while it is on; that setting has no public API. */
function templatesFolder(app: App): string | null {
  const templates = (app as unknown as { internalPlugins?: { getEnabledPluginById?(id: string): { options?: { folder?: unknown } } | null } })
    .internalPlugins?.getEnabledPluginById?.("templates");
  const folder = templates?.options?.folder;
  return typeof folder === "string" && folder.trim() ? folder.trim().replace(/^\/+|\/+$/g, "") : null;
}

class LooseEndsSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: LooseEnds) {
    super(app, plugin);
  }

  display(): void {
    const t = this.plugin.s.settings;
    const s = this.plugin.settings;
    this.containerEl.empty();
    const list = (name: string, desc: string, value: string, save: (v: string) => void) =>
      new Setting(this.containerEl)
        .setName(name)
        .setDesc(desc)
        .addTextArea((c) =>
          c.setValue(value).onChange(async (v) => {
            save(v);
            await this.plugin.saveSettings();
          }),
        );
    list(t.ignore, t.ignoreDesc, s.ignore, (v) => (s.ignore = v));
    list(t.hosts, t.hostsDesc, s.hosts.join("\n"), (v) => (s.hosts = [...new Set(parseFolders(v).map((h) => h.replace(/^\\+/, "").toLowerCase()))]));
  }
}
