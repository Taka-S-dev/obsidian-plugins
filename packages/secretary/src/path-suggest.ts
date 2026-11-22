import { AbstractInputSuggest, App } from "obsidian";
import { matchPaths, noteLocations } from "./paths.ts";

const LIMIT = 30;

/**
 * Suggests vault paths under a settings field as it is typed. For the inbox and reminders notes,
 * each folder with the note's default name (see noteLocations); for the due-date folder, folders.
 * Picking one fills the field and saves it like typing would.
 */
export class PathSuggest extends AbstractInputSuggest<string> {
  constructor(
    app: App,
    private field: HTMLInputElement,
    /** The note's default name, such as "Inbox.md"; omitted for a folder field. */
    private noteName?: string,
  ) {
    super(app, field);
  }

  protected getSuggestions(query: string): string[] {
    const folders = this.app.vault.getAllFolders(false).map((f) => f.path);
    return matchPaths(this.noteName ? noteLocations(folders, this.noteName) : folders, query, LIMIT);
  }

  renderSuggestion(path: string, el: HTMLElement): void {
    el.setText(path);
  }

  selectSuggestion(path: string): void {
    this.setValue(path);
    // The field's onChange listens for input events; setValue alone does not send one.
    this.field.dispatchEvent(new Event("input"));
    this.close();
  }
}
