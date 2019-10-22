import * as vscode from 'vscode';

const cmd = async (editor: vscode.TextEditor) => {
	console.log('gs2tc: execute:', editor.document.languageId);
	const clipboard = await vscode.env.clipboard.readText();
	let toPaste = clipboard;

	try {
		if (editor.document.languageId === 'typescript') {
			const defs = new StructScanner().scan(clipboard);
			if (defs !== null && defs.length > 0) {
				const toPasteChunks: string[] = [];
				// make a new toPaste
				defs.forEach((d) => {
					let c = 'class ' + d.name + ' {\n';
					d.fields.forEach((f) => {
						c = c + '\t' + f.jsonName + ': ' + f.type + '\n';
					});
					c = c + '}\n';
					toPasteChunks.push(c);
				});
				toPaste = toPasteChunks.join('\n');
			}
		}
	} catch (e) {
		console.log('gs2tc: error:', e);
		toPaste = clipboard;
	} finally {
		// now paste it
		editor.edit((e) => {
			const sel = editor.selection;
			if (!sel.isEmpty) {
				e.delete(sel);
			}
			e.insert(sel.start, toPaste);
		});
	}
};

export function activate(context: vscode.ExtensionContext) {
	console.log('gs2tc activated');
	const clipboardPasteActionCommand = vscode.commands.registerTextEditorCommand('editor.action.clipboardPasteAction', cmd);
	context.subscriptions.push(clipboardPasteActionCommand);
}

export function deactivate() { }

class StructScanner {

	private typeAliases: Map<string, string>;

	constructor() {
		this.typeAliases = new Map<string, string>();
	}

	scan(text: string): StructDef[] {
		// pass 1 - type aliases
		this.scanInternal(text, 1);
		// pass 2 - outputs
		return this.scanInternal(text, 2);
	}

	private scanInternal(text: string, pass: number): StructDef[] {
		console.log('scanInternal:', pass, this.typeAliases);

		text = text || '';

		if (text.length === 0 || text.indexOf(' struct {') === -1) {
			// not a go struct
			return [];
		}

		let defs: StructDef[] = [];

		// really dumb version of parsing some go code -- expects fmt'd struct definitions
		// does not deal with embedded struct definitions
		var workingDef: StructDef | null;


		const lines = text.split('\n');
		lines.forEach((line) => {
			console.log('line:', line);

			line = line.trim();
			if (line.length === 0) {
				return;
			}
			if (line.startsWith('/')) {
				// ignore comments
				return;
			}

			const structMatch = line.match(/type ([a-zA-Z0-9_]+) ([a-zA-Z0-9_]+)/);
			if (structMatch && structMatch.length === 3) {
				console.log('struct-match:', line);

				let structName = structMatch[1].trim();
				let typName = structMatch[2].trim();

				if (pass === 1 && typName !== 'struct') {
					console.log('type alias:', structName, typName);
					// this is a type alias
					this.typeAliases.set(structName, typName);
					// TODO: should we create actual typescript aliases?
				}

				// starting a new struct
				workingDef = { name: "", fields: [] };
				workingDef.name = structMatch[1];

			} else if (pass === 2 && workingDef) {
				if (line === "}") {
					defs.push(workingDef);
					workingDef = null;
				} else {
					console.log('struct-inner-line:', line);
					const fieldMatch = line.match(/^\s*([a-zA-Z0-9_]+)\s+([a-zA-Z0-9_\.]+)\s+(`[^`]+`)?/);
					console.log('fieldMatch:', fieldMatch);

					if (fieldMatch && fieldMatch.length === 4) {
						let name = fieldMatch[1].trim();
						let jsonName = name;
						let typ = fieldMatch[2];

						const tagMatch = fieldMatch[3];
						if (tagMatch) {
							const jsonTagMatch = tagMatch.match(/json:"([^"]*)"/);
							console.log('jsonTagMatch:', jsonTagMatch);
							if (jsonTagMatch && jsonTagMatch.length === 2) {
								jsonName = jsonTagMatch[1];
								// we don't care about omitempty or the string option (probably do, but meh)
								jsonName = jsonName.replace('string', '');
								jsonName = jsonName.replace('omitempty', '');
								jsonName = jsonName.replace(',', '');
								jsonName = jsonName.trim();
							}
						}

						if (typ === 'bool') {
							typ = 'boolean';
						}
						const typeAlias = this.typeAliases.get(typ);
						if (typeAlias) {
							typ = typeAlias;
						}

						if (jsonName === '-') {
							console.log('json defined as -');
							return;
						}

						// a def line
						workingDef.fields.push({
							name: name,
							type: typ,
							jsonName: jsonName
						});
					}
				}
			}
		});

		return defs;
	}

}

interface StructDef {
	name: string;
	fields: FieldDef[];
}

interface FieldDef {
	name: string;
	type: string;
	jsonName: string;
}