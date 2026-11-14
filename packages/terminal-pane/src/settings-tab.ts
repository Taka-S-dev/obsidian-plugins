import { type App, FuzzySuggestModal, PluginSettingTab, Setting } from "obsidian";
import type TerminalPanePlugin from "./main.ts";
import { commandName, hotkeyText, listCommands } from "./obsidian-internals.ts";
import { FONT_SIZE, newProfileId, type Location } from "./settings.ts";

interface CommandChoice {
  id: string;
  name: string;
}

/** Picks a command from the same list the command palette shows. */
class CommandSuggestModal extends FuzzySuggestModal<CommandChoice> {
  constructor(app: App, placeholder: string, private readonly exclude: Set<string>, private readonly choose: (id: string) => void) {
    super(app);
    this.setPlaceholder(placeholder);
  }

  getItems(): CommandChoice[] {
    return listCommands(this.app)
      .filter((command) => !this.exclude.has(command.id))
      .map(({ id, name }) => ({ id, name }));
  }

  getItemText(item: CommandChoice): string {
    const keys = hotkeyText(this.app, item.id);
    return keys ? `${item.name} (${keys})` : item.name;
  }

  onChooseItem(item: CommandChoice): void {
    this.choose(item.id);
  }
}

export class TerminalSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TerminalPanePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl, plugin } = this;
    const { settings, s } = plugin;
    const t = s.settings;
    containerEl.empty();

    new Setting(containerEl).setName(t.profiles).setDesc(t.profilesDesc).setHeading();
    for (const profile of settings.profiles) {
      new Setting(containerEl)
        .setClass("terminal-pane-profile")
        .addText((text) => text
          .setPlaceholder(t.name)
          .setValue(profile.name)
          .onChange(async (value) => { profile.name = value; await plugin.saveSettings(); }))
        .addText((text) => {
          text.inputEl.addClass("terminal-pane-command");
          text
            .setPlaceholder(t.command)
            .setValue(profile.command)
            .onChange(async (value) => { profile.command = value; await plugin.saveSettings(); });
        })
        .addExtraButton((button) => button
          .setIcon("trash-2")
          .setTooltip(t.remove)
          .setDisabled(settings.profiles.length === 1)
          .onClick(async () => {
            if (settings.profiles.length === 1) return;
            settings.profiles = settings.profiles.filter((p) => p !== profile);
            if (settings.defaultProfile === profile.id) settings.defaultProfile = settings.profiles[0].id;
            await plugin.saveSettings();
            this.display();
          }));
    }
    new Setting(containerEl).addButton((button) => button
      .setButtonText(t.add)
      .onClick(async () => {
        const id = newProfileId(settings.profiles.map((p) => p.id));
        settings.profiles.push({ id, name: t.newProfile, command: "" });
        await plugin.saveSettings();
        this.display();
      }));

    new Setting(containerEl)
      .setName(t.defaultProfile)
      .setDesc(t.defaultProfileDesc)
      .addDropdown((dropdown) => {
        for (const p of settings.profiles) dropdown.addOption(p.id, p.name || p.command || p.id);
        dropdown.setValue(settings.defaultProfile).onChange(async (value) => {
          settings.defaultProfile = value;
          await plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName(t.location).addDropdown((dropdown) => dropdown
      .addOption("right", t.locationRight)
      .addOption("tab", t.locationTab)
      .setValue(settings.location)
      .onChange(async (value) => { settings.location = value as Location; await plugin.saveSettings(); }));

    new Setting(containerEl).setName(t.fontSize).addSlider((slider) => slider
      .setLimits(FONT_SIZE.min, FONT_SIZE.max, 1)
      .setValue(settings.fontSize)
      .setDynamicTooltip()
      .onChange(async (value) => { settings.fontSize = value; await plugin.saveSettings(); }));

    new Setting(containerEl).setName(t.fontFamily).setDesc(t.fontFamilyDesc).addText((text) => text
      .setPlaceholder("JetBrainsMono Nerd Font, Consolas")
      .setValue(settings.fontFamily)
      .onChange(async (value) => { settings.fontFamily = value.trim(); await plugin.saveSettings(); }));

    new Setting(containerEl).setName(t.shiftEnterNewline).setDesc(t.shiftEnterNewlineDesc).addToggle((toggle) => toggle
      .setValue(settings.shiftEnterNewline)
      .onChange(async (value) => { settings.shiftEnterNewline = value; await plugin.saveSettings(); }));
    new Setting(containerEl).setName(t.notifications).setDesc(t.notificationsDesc).addToggle((toggle) => toggle
      .setValue(settings.notifications)
      .onChange(async (value) => { settings.notifications = value; await plugin.saveSettings(); }));
    new Setting(containerEl).setName(t.shareWithClaude).setDesc(t.shareWithClaudeDesc).addToggle((toggle) => toggle
      .setValue(settings.shareWithClaude)
      .onChange(async (value) => {
        settings.shareWithClaude = value;
        await plugin.saveSettings();
        await plugin.applyClaudeSharing();
      }));

    this.displayObsidianCommands(containerEl);

    new Setting(containerEl).setName(t.advanced).setHeading();
    new Setting(containerEl).setName(t.bundledConpty).setDesc(t.bundledConptyDesc).addToggle((toggle) => toggle
      .setValue(settings.bundledConpty)
      .onChange(async (value) => { settings.bundledConpty = value; await plugin.saveSettings(); }));

    new Setting(containerEl).setName(t.nodePath).setDesc(t.nodePathDesc).addText((text) => text
      .setPlaceholder("node")
      .setValue(settings.nodePath)
      .onChange(async (value) => { settings.nodePath = value.trim() || "node"; await plugin.saveSettings(); }));
  }

  /** The Obsidian commands whose hotkeys work while a terminal has the keyboard. */
  private displayObsidianCommands(containerEl: HTMLElement): void {
    const { app, plugin } = this;
    const { settings } = plugin;
    const t = plugin.s.settings;
    new Setting(containerEl).setName(t.obsidianCommands).setDesc(t.obsidianCommandsDesc).setHeading();
    for (const id of settings.obsidianCommands) {
      const name = commandName(app, id);
      new Setting(containerEl)
        .setName(name ?? t.commandMissing(id))
        .setDesc(hotkeyText(app, id) || t.noHotkey)
        .addExtraButton((button) => button
          .setIcon("trash-2")
          .setTooltip(t.removeCommand)
          .onClick(async () => {
            settings.obsidianCommands = settings.obsidianCommands.filter((other) => other !== id);
            await plugin.saveSettings();
            this.display();
          }));
    }
    new Setting(containerEl).addButton((button) => button
      .setButtonText(t.addCommand)
      .onClick(() => {
        const exclude = new Set([...settings.obsidianCommands, ...plugin.ownCommandIds()]);
        new CommandSuggestModal(app, t.chooseCommand, exclude, async (id) => {
          settings.obsidianCommands.push(id);
          await plugin.saveSettings();
          this.display();
        }).open();
      }));
  }

  /** Command names follow profile names; rebuilding them on every keystroke is not needed. */
  hide(): void {
    this.plugin.registerProfileCommands();
  }
}
