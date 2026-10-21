import { App, Component, TFile } from "obsidian";
import { EditorSelection, Transaction } from "@codemirror/state";

export interface MarkdownEditorCursorLocation {
	anchor: number;
	head: number;
}

export interface MarkdownEditorOptions {
	value?: string;
	placeholder?: string;
	cls?: string;
	cursorLocation?: MarkdownEditorCursorLocation;
	skipInitialCursor?: boolean;
	onEnter?: (
		editor: EmbeddableMarkdownEditor,
		mod: boolean,
		shift: boolean,
	) => boolean;
	onEscape?: (editor: EmbeddableMarkdownEditor) => void;
	onSubmit?: (editor: EmbeddableMarkdownEditor) => void;
	onSave?: (editor: EmbeddableMarkdownEditor) => void;
	onBlur?: (editor: EmbeddableMarkdownEditor) => void;
	onPaste?: (event: ClipboardEvent, editor: EmbeddableMarkdownEditor) => void;
	onChange?: (value: string) => void;
}

interface EditorDocumentLike {
	length: number;
	toString(): string;
}

interface EditorSelectionStateLike {
	main: {
		head: number;
	};
}

interface EditorViewLike {
	dom?: HTMLElement;
	contentDOM?: HTMLElement;
	state: {
		doc: EditorDocumentLike;
		selection: EditorSelectionStateLike;
	};
	dispatch(spec: {
		changes?: { from: number; to: number; insert: string };
		annotations?: unknown;
		selection?: unknown;
	}): void;
	focus(): void;
}

interface NativeEditorLike {
	cm?: EditorViewLike;
	getValue?: () => string;
	setValue?: (value: string) => void;
}

interface WidgetEditorLike {
	editable?: boolean;
	showEditor?: () => void;
	unload?: () => void;
	editMode?: {
		editor?: NativeEditorLike;
	};
}

type MarkdownEmbedFactory = (
	context: { app: App; containerEl: HTMLElement },
	file: TFile,
	content: string,
) => WidgetEditorLike | null | undefined;

type AppWithEmbedRegistry = App & {
	embedRegistry?: {
		embedByExtension?: {
			md?: MarkdownEmbedFactory;
		};
	};
};

export class EmbeddableMarkdownEditor extends Component {
	private readonly app: App;
	private readonly containerEl: HTMLElement;
	private readonly options: MarkdownEditorOptions;
	private readonly readyPromise: Promise<void>;
	private widgetEditor: WidgetEditorLike | null = null;
	private editorEl: HTMLElement | null = null;
	private _value: string;
	private hasShownEditor = false;

	constructor(
		app: App,
		containerEl: HTMLElement,
		options: MarkdownEditorOptions = {},
	) {
		super();
		this.app = app;
		this.containerEl = containerEl;
		this.options = options;
		this._value = options.value ?? "";

		this.readyPromise = this.initialize();
	}

	static isSupported(app: App): boolean {
		const internalApp = app as AppWithEmbedRegistry;
		return Boolean(internalApp.embedRegistry?.embedByExtension?.md);
	}

	get value(): string {
		const nativeEditor = this.widgetEditor?.editMode?.editor;
		if (nativeEditor) {
			try {
				if (typeof nativeEditor.getValue === "function") {
					return nativeEditor.getValue();
				}

				if (nativeEditor.cm) {
					return nativeEditor.cm.state.doc.toString();
				}
			} catch (error) {
				console.warn("EmbeddableMarkdownEditor: failed to read native value", error);
			}
		}

		const textarea = this.editorEl instanceof HTMLTextAreaElement
			? this.editorEl
			: null;
		return textarea?.value ?? this._value;
	}

	whenReady(): Promise<void> {
		return this.readyPromise;
	}

	async initialize(): Promise<void> {
		try {
			const created = await this.createObsidianEditor();
			if (!created) {
				this.createTextareaEditor();
			}
		} catch (error) {
			console.warn("EmbeddableMarkdownEditor: initialization failed", error);
			this.createTextareaEditor();
		}
	}

	isUsable(): boolean {
		const editorEl = this.resolveEditorElement();
		return Boolean(
			editorEl &&
			editorEl.isConnected &&
			this.containerEl.isConnected &&
			this.containerEl.contains(editorEl)
		);
	}

	hasValue(value: string): boolean {
		return this._value === value;
	}

	setValue(value: string): void {
		this._value = value;

		const nativeEditor = this.widgetEditor?.editMode?.editor;
		if (nativeEditor) {
			try {
				if (nativeEditor.cm) {
					nativeEditor.cm.dispatch({
						changes: {
							from: 0,
							to: nativeEditor.cm.state.doc.length,
							insert: value,
						},
						annotations: Transaction.addToHistory.of(false),
					});
					return;
				}

				if (typeof nativeEditor.setValue === "function") {
					nativeEditor.setValue(value);
					return;
				}
			} catch (error) {
				console.warn("EmbeddableMarkdownEditor: failed to write native value", error);
			}
		}

		if (this.editorEl instanceof HTMLTextAreaElement) {
			this.editorEl.value = value;
		}
	}

	focus(): void {
		const nativeEditor = this.widgetEditor?.editMode?.editor;
		if (nativeEditor?.cm) {
			try {
				nativeEditor.cm.focus();
				return;
			} catch (error) {
				console.warn("EmbeddableMarkdownEditor: failed to focus native editor", error);
			}
		}

		if (this.editorEl instanceof HTMLTextAreaElement) {
			this.editorEl.focus();
		}
	}

	blur(): void {
		const nativeEditor = this.widgetEditor?.editMode?.editor;
		const activeElement = document.activeElement;
		const contentDOM = nativeEditor?.cm?.contentDOM;

		if (
			activeElement instanceof HTMLElement &&
			(
				(contentDOM instanceof HTMLElement && contentDOM.contains(activeElement)) ||
				(this.editorEl instanceof HTMLElement && this.editorEl.contains(activeElement))
			)
		) {
			activeElement.blur();
		}

		if (contentDOM instanceof HTMLElement) {
			contentDOM.blur();
		}

		if (this.editorEl instanceof HTMLElement) {
			this.editorEl.blur();
		}
	}

	getCursor(): number {
		const nativeEditor = this.widgetEditor?.editMode?.editor;
		if (nativeEditor?.cm) {
			try {
				return nativeEditor.cm.state.selection.main.head;
			} catch (error) {
				console.warn("EmbeddableMarkdownEditor: failed to read cursor", error);
			}
		}

		if (this.editorEl instanceof HTMLTextAreaElement) {
			return this.editorEl.selectionStart;
		}

		return 0;
	}

	setCursor(position: number, shouldFocus = true): void {
		const nativeEditor = this.widgetEditor?.editMode?.editor;
		if (nativeEditor?.cm) {
			try {
				nativeEditor.cm.dispatch({
					selection: EditorSelection.cursor(position),
				});
				return;
			} catch (error) {
				console.warn("EmbeddableMarkdownEditor: failed to set cursor", error);
			}
		}

		if (this.editorEl instanceof HTMLTextAreaElement) {
			this.editorEl.selectionStart = position;
			this.editorEl.selectionEnd = position;
			if (shouldFocus) {
				this.editorEl.focus();
			}
		}
	}

	setCursorToEnd(shouldFocus = true): void {
		this.setCursor(this.value.length, shouldFocus);
	}

	submit(): void {
		this.options.onSubmit?.(this);
	}

	reveal(force = false): void {
		if (!this.widgetEditor?.showEditor) {
			return;
		}

		if (this.hasShownEditor && !force) {
			return;
		}

		this.widgetEditor.showEditor();
		this.hasShownEditor = true;
	}

	destroy(): void {
		if (this.widgetEditor) {
			try {
				this.widgetEditor.unload?.();
			} catch (error) {
				console.warn("EmbeddableMarkdownEditor: failed to unload widget editor", error);
			}
			this.widgetEditor = null;
		}

		this.editorEl = null;
		this.hasShownEditor = false;
		this.containerEl.replaceChildren();
		super.unload();
	}

	private async createObsidianEditor(): Promise<boolean> {
		const internalApp = this.app as AppWithEmbedRegistry;
		const factory = internalApp.embedRegistry?.embedByExtension?.md;
		if (!factory) {
			return false;
		}

		const widgetEditor = factory(
			{ app: this.app, containerEl: this.containerEl },
			null as unknown as TFile,
			this._value,
		);

		if (!widgetEditor) {
			return false;
		}

		this.widgetEditor = widgetEditor;
		this.widgetEditor.editable = true;
		this.reveal(true);

		const editor = this.widgetEditor.editMode?.editor;
		if (!editor) {
			return false;
		}

		this.editorEl = await this.waitForEditorElement(editor);

		if (this._value) {
			this.applyValueToNativeEditor(editor, this._value);
		}

		if (!this.options.skipInitialCursor) {
			if (this.options.cursorLocation) {
				this.applyCursorToNativeEditor(editor, this.options.cursorLocation);
			} else {
				this.applyCursorToNativeEditor(editor, {
					anchor: this._value.length,
					head: this._value.length,
				});
			}
		}

		if (this.options.cls && this.editorEl) {
			this.editorEl.classList.add(this.options.cls);
		}

		this.setupObsidianEditorEvents(editor);
		return true;
	}

	private resolveEditorElement(editor?: NativeEditorLike): HTMLElement | null {
		const nativeEditorEl = editor?.cm?.dom;
		if (nativeEditorEl instanceof HTMLElement) {
			this.editorEl = nativeEditorEl;
			return nativeEditorEl;
		}

		if (
			this.editorEl instanceof HTMLElement &&
			this.editorEl.isConnected &&
			this.containerEl.contains(this.editorEl)
		) {
			return this.editorEl;
		}

		const containerEditorEl = this.containerEl.querySelector<HTMLElement>(
			".cm-editor, textarea"
		);
		if (containerEditorEl) {
			this.editorEl = containerEditorEl;
			return containerEditorEl;
		}

		return null;
	}

	private async waitForEditorElement(
		editor: NativeEditorLike,
	): Promise<HTMLElement | null> {
		const immediateEditorEl = this.resolveEditorElement(editor);
		if (immediateEditorEl) {
			return immediateEditorEl;
		}

		await new Promise<void>((resolve) => {
			window.requestAnimationFrame(() => resolve());
		});

		return this.resolveEditorElement(editor);
	}

	private applyValueToNativeEditor(
		editor: NativeEditorLike,
		value: string,
	): void {
		try {
			if (editor.cm) {
				editor.cm.dispatch({
					changes: {
						from: 0,
						to: editor.cm.state.doc.length,
						insert: value,
					},
					annotations: Transaction.addToHistory.of(false),
				});
				return;
			}

			if (typeof editor.setValue === "function") {
				editor.setValue(value);
			}
		} catch (error) {
			console.warn("EmbeddableMarkdownEditor: failed to apply value", error);
		}
	}

	private applyCursorToNativeEditor(
		editor: NativeEditorLike,
		cursorLocation: MarkdownEditorCursorLocation,
	): void {
		if (!editor.cm) {
			return;
		}

		try {
			editor.cm.dispatch({
				selection: EditorSelection.range(
					cursorLocation.anchor,
					cursorLocation.head,
				),
			});
		} catch (error) {
			console.warn("EmbeddableMarkdownEditor: failed to apply cursor", error);
		}
	}

	private setupObsidianEditorEvents(editor: NativeEditorLike): void {
		const view = editor.cm;
		const contentDOM = view?.contentDOM ?? view?.dom;
		if (!contentDOM) {
			return;
		}

		let pendingChangeSyncFrame: number | null = null;

		const flushChange = () => {
			pendingChangeSyncFrame = null;

			const nextValue = this.value;
			if (nextValue !== this._value) {
				this._value = nextValue;
				this.options.onChange?.(nextValue);
			}
		};

		const changeHandler = () => {
			if (pendingChangeSyncFrame !== null) {
				return;
			}

			pendingChangeSyncFrame = window.requestAnimationFrame(flushChange);
		};

		const keydownHandler = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				this.options.onEscape?.(this);
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			if (event.key === "Enter") {
				const mod = event.ctrlKey || event.metaKey;
				const shift = event.shiftKey;
				if (this.options.onEnter?.(this, mod, shift)) {
					event.preventDefault();
				}
				return;
			}

			if (event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey)) {
				this.options.onSave?.(this);
				event.preventDefault();
			}
		};

		const isFocusInsideEditor = (target: EventTarget | null): boolean => {
			if (!(target instanceof Node)) {
				return false;
			}

			if (this.editorEl instanceof HTMLElement && this.editorEl.contains(target)) {
				return true;
			}

			return this.containerEl.contains(target);
		};

		let pendingBlurTimer: number | null = null;

		const clearPendingBlur = () => {
			if (pendingBlurTimer !== null) {
				window.clearTimeout(pendingBlurTimer);
				pendingBlurTimer = null;
			}
		};

		const blurHandler = (event: FocusEvent) => {
			const nextTarget = event.relatedTarget;
			if (isFocusInsideEditor(nextTarget)) {
				return;
			}

			clearPendingBlur();
			pendingBlurTimer = window.setTimeout(() => {
				if (!isFocusInsideEditor(document.activeElement)) {
					this.options.onBlur?.(this);
				}
				pendingBlurTimer = null;
			}, 100);
		};

		const focusHandler = () => {
			clearPendingBlur();
		};

		const pasteHandler = (event: ClipboardEvent) => {
			this.options.onPaste?.(event, this);
		};

		this.registerDomEvent(contentDOM, "keydown", keydownHandler);
		this.registerDomEvent(contentDOM, "focusout", blurHandler);
		this.registerDomEvent(contentDOM, "focusin", focusHandler);
		this.registerDomEvent(contentDOM, "paste", pasteHandler);
		this.registerDomEvent(contentDOM, "input", changeHandler);

		const observer = new MutationObserver(changeHandler);
		observer.observe(contentDOM, {
			childList: true,
			subtree: true,
			characterData: true,
		});

		this.register(() => {
			clearPendingBlur();
			if (pendingChangeSyncFrame !== null) {
				window.cancelAnimationFrame(pendingChangeSyncFrame);
				pendingChangeSyncFrame = null;
			}
			observer.disconnect();
		});
	}

	private createTextareaEditor(): void {
		const textarea = document.createElement("textarea");
		textarea.className = [this.options.cls, "embeddable-editor-textarea"].filter(Boolean).join(" ");
		textarea.placeholder = this.options.placeholder || "Edit markdown here...";
		textarea.value = this._value;

		const syncTextareaValue = () => {
			this._value = textarea.value;
			this.options.onChange?.(this._value);
		};

		this.registerDomEvent(textarea, "input", syncTextareaValue);

		const keydownHandler = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				this.options.onEscape?.(this);
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			if (event.key === "Enter") {
				const mod = event.ctrlKey || event.metaKey;
				const shift = event.shiftKey;
				if (this.options.onEnter?.(this, mod, shift)) {
					event.preventDefault();
				}
				return;
			}

			if (event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey)) {
				this.options.onSave?.(this);
				event.preventDefault();
				return;
			}

			if (event.key === "Tab") {
				event.preventDefault();
				const start = textarea.selectionStart;
				const end = textarea.selectionEnd;
				textarea.value =
					textarea.value.slice(0, start) +
					"\t" +
					textarea.value.slice(end);
				textarea.selectionStart = start + 1;
				textarea.selectionEnd = start + 1;
				syncTextareaValue();
			}
		};
		this.registerDomEvent(textarea, "keydown", keydownHandler);

		const blurHandler = () => {
			this.options.onBlur?.(this);
		};
		this.registerDomEvent(textarea, "blur", blurHandler);

		const pasteHandler = (event: ClipboardEvent) => {
			this.options.onPaste?.(event, this);
		};
		this.registerDomEvent(textarea, "paste", pasteHandler);

		this.containerEl.replaceChildren(textarea);
		this.editorEl = textarea;

		const initialCursorTimer = window.setTimeout(() => {
			if (this.options.skipInitialCursor) {
				return;
			}

			const cursorLocation = this.options.cursorLocation;
			if (cursorLocation) {
				textarea.selectionStart = cursorLocation.anchor;
				textarea.selectionEnd = cursorLocation.head;
				return;
			}

			const length = textarea.value.length;
			textarea.selectionStart = length;
			textarea.selectionEnd = length;
		}, 0);

		this.register(() => {
			window.clearTimeout(initialCursorTimer);
		});
	}
}
