import * as monaco from 'monaco-editor';
import { api, capabilities, Diagnostic, DiagnosticRegistrationOptions, DocumentDiagnosticReport, PublishDiagnosticsParams } from '../types';
import { Disposable, DisposableStore } from '../utils';
import { LspConnection } from '../LspConnection';
import { lspDiagnosticTagToMonacoMarkerTag, matchesDocumentSelector, toDiagnosticMarker } from './common';

/** Distinct owner per connection, so switching servers can't leave markers behind */
let nextOwnerId = 0;

export class LspDiagnosticsFeature extends Disposable {
	private readonly _diagnosticsMarkerOwner = `lsp-${nextOwnerId++}`;
	private readonly _pullDiagnosticProviders = new Map<monaco.editor.ITextModel, ModelDiagnosticProvider>();
	/** Models we have set markers on, so they can all be cleared on dispose */
	private readonly _markedModels = new Set<monaco.editor.ITextModel>();

	constructor(
		private readonly _connection: LspConnection,
	) {
		super();

		this._register(this._connection.capabilities.addStaticClientCapabilities({
			textDocument: {
				publishDiagnostics: {
					relatedInformation: true,
					tagSupport: {
						valueSet: [...lspDiagnosticTagToMonacoMarkerTag.keys()],
					},
					versionSupport: true,
					codeDescriptionSupport: true,
					dataSupport: true,
				},
				diagnostic: {
					dynamicRegistration: true,
					relatedDocumentSupport: true,
				}
			}
		}));

		this._register(this._connection.connection.registerNotificationHandler(
			api.client.textDocumentPublishDiagnostics,
			(params) => this._handlePublishDiagnostics(params)
		));

		this._register(this._connection.capabilities.registerCapabilityHandler(
			capabilities.textDocumentDiagnostic,
			true,
			(capability) => {
				const disposables = new DisposableStore();
				for (const model of monaco.editor.getModels()) {
					this._addPullDiagnosticProvider(model, capability, disposables);
				}
				disposables.add(monaco.editor.onDidCreateModel(model => {
					this._addPullDiagnosticProvider(model, capability, disposables);
				}));
				return disposables;
			}
		));
	}

	/**
	 * Drop every marker this connection published.
	 *
	 * The owner used to be a shared constant that was never cleared, so the
	 * previous language's errors stayed in the gutter and the problems list
	 * after switching servers.
	 */
	override dispose(): void {
		for (const model of this._markedModels) {
			if (!model.isDisposed()) {
				monaco.editor.setModelMarkers(model, this._diagnosticsMarkerOwner, []);
			}
		}
		this._markedModels.clear();
		for (const provider of this._pullDiagnosticProviders.values()) {
			provider.dispose();
		}
		this._pullDiagnosticProviders.clear();
		this._connection.diagnostics.clear();
		super.dispose();
	}

	private _setMarkers(model: monaco.editor.ITextModel, markers: monaco.editor.IMarkerData[]): void {
		monaco.editor.setModelMarkers(model, this._diagnosticsMarkerOwner, markers);
		if (markers.length > 0) {
			this._markedModels.add(model);
		} else {
			this._markedModels.delete(model);
		}
	}

	private _addPullDiagnosticProvider(
		model: monaco.editor.ITextModel,
		capability: DiagnosticRegistrationOptions,
		disposables: DisposableStore
	): void {
		if (this._pullDiagnosticProviders.has(model)) {
			return;
		}
		// Pull diagnostics used to be requested for every model on the page,
		// including ones this server was never started for and `inmemory://`
		// scratch models it could not resolve at all.
		if (!this._connection.isInScope(model)) {
			return;
		}
		if (!matchesDocumentSelector(model, capability.documentSelector)) {
			return;
		}

		const provider = new ModelDiagnosticProvider(
			model,
			this._connection,
			capability,
			(m, markers) => this._setMarkers(m, markers),
		);

		this._pullDiagnosticProviders.set(model, provider);
		disposables.add(provider);

		// Tear the provider down with its model — leaving it registered kept a
		// pending timer and an obsolete entry alive for the whole session.
		const subscription = model.onWillDispose(() => {
			this._pullDiagnosticProviders.get(model)?.dispose();
			this._pullDiagnosticProviders.delete(model);
			this._markedModels.delete(model);
			subscription.dispose();
		});
		disposables.add(subscription);
	}

	private _handlePublishDiagnostics(params: PublishDiagnosticsParams): void {
		const uri = params.uri;
		const diagnostics = params.diagnostics ?? [];

		const model = this._connection.bridge.findTextModel({ uri });
		if (!model || model.isDisposed()) {
			// Nothing to mark, and nothing to keep: the originals exist only to
			// answer code-action requests against an open document, so storing
			// them for files that are not open grew the map for the lifetime of
			// the connection and served no request.
			this._connection.diagnostics.delete(uri);
			return;
		}

		// Keep the originals: `data` and the structured `code` are what servers
		// need back on a code-action request, and a Monaco marker has nowhere
		// to put them.
		this._connection.diagnostics.set(uri, diagnostics);

		this._setMarkers(model, diagnostics.map(diagnostic => toDiagnosticMarker(diagnostic)));
	}
}

/**
 * Manages pull diagnostics for a single text model
 */
class ModelDiagnosticProvider extends Disposable {
	private _updateHandle: number | undefined;
	private _previousResultId: string | undefined;
	private _disposed = false;

	constructor(
		private readonly _model: monaco.editor.ITextModel,
		private readonly _connection: LspConnection,
		private readonly _capability: DiagnosticRegistrationOptions,
		private readonly _publish: (model: monaco.editor.ITextModel, markers: monaco.editor.IMarkerData[]) => void,
	) {
		super();
		this._register(this._model.onDidChangeContent(() => {
			this._scheduleDiagnosticUpdate();
		}));
		this._scheduleDiagnosticUpdate();
	}

	private _scheduleDiagnosticUpdate(): void {
		if (this._updateHandle !== undefined) {
			clearTimeout(this._updateHandle);
		}

		this._updateHandle = window.setTimeout(() => {
			this._updateHandle = undefined;
			void this._requestDiagnostics();
		}, 500);
	}

	private async _requestDiagnostics(): Promise<void> {
		if (this._disposed || this._model.isDisposed()) {
			return;
		}

		try {
			const translated = this._connection.bridge.translate(this._model, new monaco.Position(1, 1));

			const result = await this._connection.server.textDocumentDiagnostic({
				textDocument: translated.textDocument,
				identifier: this._capability.identifier,
				previousResultId: this._previousResultId,
			});

			if (this._disposed || this._model.isDisposed()) {
				return;
			}

			this._handleDiagnosticReport(translated.textDocument.uri, result);
		} catch (error) {
			console.error('Error requesting diagnostics:', error);
		}
	}

	private _handleDiagnosticReport(uri: string, report: DocumentDiagnosticReport): void {
		if (report.kind === 'full') {
			this._previousResultId = report.resultId;
			this._connection.diagnostics.set(uri, report.items);
			this._publish(this._model, report.items.map(diagnostic => toDiagnosticMarker(diagnostic)));

			if ('relatedDocuments' in report && report.relatedDocuments) {
				this._handleRelatedDocuments(report.relatedDocuments);
			}
		} else if (report.kind === 'unchanged') {
			// Unchanged report - diagnostics are still valid
			this._previousResultId = report.resultId;
		}
	}

	private _handleRelatedDocuments(relatedDocuments: { [key: string]: any }): void {
		for (const [uri, report] of Object.entries(relatedDocuments)) {
			if (report?.kind !== 'full') {
				continue;
			}
			this._connection.diagnostics.set(uri, report.items ?? []);

			const model = this._connection.bridge.findTextModel({ uri });
			if (!model || model.isDisposed()) {
				continue;
			}
			this._publish(model, (report.items as Diagnostic[]).map(diagnostic => toDiagnosticMarker(diagnostic)));
		}
	}

	override dispose(): void {
		this._disposed = true;
		if (this._updateHandle !== undefined) {
			clearTimeout(this._updateHandle);
			this._updateHandle = undefined;
		}
		super.dispose();
	}
}
